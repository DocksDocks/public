import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import type { Ctx } from "./index"
import {
  WORKFLOW_RECORD_PREFIX,
  buildWorkflowRecord,
  defaultWorkflowRecord,
  parseWorkflowRecord,
  renderWorkflowRecordLine,
  type WorkflowOverrides,
  type WorkflowRecord
} from "../workflowModels"

export interface WorkflowFileSystem {
  readonly read: (path: string) => string | undefined
  readonly writeAtomic: (path: string, bytes: string) => void
  readonly remove: (path: string) => void
}

let atomicWriteSequence = 0

const nodeFileSystem: WorkflowFileSystem = {
  read: (path) => existsSync(path) ? readFileSync(path, "utf8") : undefined,
  writeAtomic: (path, bytes) => {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${process.pid}-${atomicWriteSequence++}`
    try {
      writeFileSync(temporary, bytes)
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  },
  remove: (path) => rmSync(path, { force: true })
}

interface DocumentRecord {
  readonly record: WorkflowRecord | undefined
  readonly line: string | undefined
}

function readDocumentRecord(document: string | undefined, label: string): DocumentRecord {
  const lines = (document ?? "").split("\n").filter((line) => line.startsWith(WORKFLOW_RECORD_PREFIX))
  if (lines.length === 0) return { record: undefined, line: undefined }

  let canonicalLine: string | undefined
  let canonicalRecord: WorkflowRecord | undefined
  for (const line of lines) {
    let record: WorkflowRecord
    try {
      record = parseWorkflowRecord(JSON.parse(line.slice(WORKFLOW_RECORD_PREFIX.length)) as unknown)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${label} contains a malformed Docks workflow record: ${detail}`)
    }
    const rendered = renderWorkflowRecordLine(record)
    if (canonicalLine !== undefined && rendered !== canonicalLine) {
      throw new Error(`${label} contains conflicting Docks workflow records`)
    }
    canonicalLine = rendered
    canonicalRecord = record
  }
  return { record: canonicalRecord, line: canonicalLine }
}

export function upsertWorkflowRecord(document: string, record: WorkflowRecord): string {
  const content = document
    .split("\n")
    .filter((line) => !line.startsWith(WORKFLOW_RECORD_PREFIX))
    .join("\n")
    .replace(/\n+$/, "")
  const line = renderWorkflowRecordLine(record)
  return content === "" ? `${line}\n` : `${content}\n${line}\n`
}

export function renderDefaultWorkflowInstructions(document: string): string {
  readDocumentRecord(document, "SoT instruction document")
  return upsertWorkflowRecord(document, defaultWorkflowRecord())
}

function restoreSnapshot(fileSystem: WorkflowFileSystem, path: string, snapshot: string | undefined): void {
  if (snapshot === undefined) fileSystem.remove(path)
  else fileSystem.writeAtomic(path, snapshot)
}

export function deployWorkflowOverrides(
  ctx: Ctx,
  overrides: WorkflowOverrides,
  fileSystem: WorkflowFileSystem = nodeFileSystem
): void {
  const claudePath = `${ctx.home}/.claude/CLAUDE.md`
  const codexPath = `${ctx.home}/.codex/AGENTS.md`
  const claudeBefore = fileSystem.read(claudePath)
  const codexBefore = fileSystem.read(codexPath)
  const claudeState = readDocumentRecord(claudeBefore, claudePath)
  const codexState = readDocumentRecord(codexBefore, codexPath)

  if (claudeState.line !== undefined && codexState.line !== undefined && claudeState.line !== codexState.line) {
    throw new Error("Claude and Codex instruction files contain conflicting Docks workflow records")
  }

  const base = claudeState.record ?? codexState.record ?? defaultWorkflowRecord()
  const record = buildWorkflowRecord(overrides, base)
  const claudeAfter = upsertWorkflowRecord(claudeBefore ?? "", record)
  const codexAfter = upsertWorkflowRecord(codexBefore ?? "", record)
  const claudeChanged = claudeBefore !== claudeAfter
  const codexChanged = codexBefore !== codexAfter

  if (ctx.dryRun) {
    if (claudeChanged) ctx.services.logger.echo(`[dry-run] update Docks workflow record in ${claudePath}`)
    if (codexChanged) ctx.services.logger.echo(`[dry-run] update Docks workflow record in ${codexPath}`)
    if (!claudeChanged && !codexChanged) ctx.services.logger.verbose("Workflow models already match the requested state")
    return
  }

  if (!claudeChanged && !codexChanged) {
    ctx.services.logger.verbose("Workflow models already match the requested state")
    return
  }

  try {
    if (claudeChanged) fileSystem.writeAtomic(claudePath, claudeAfter)
    if (codexChanged) fileSystem.writeAtomic(codexPath, codexAfter)
  } catch (error) {
    try {
      restoreSnapshot(fileSystem, claudePath, claudeBefore)
      restoreSnapshot(fileSystem, codexPath, codexBefore)
    } finally {
      ctx.services.logger.err("Workflow update failed; restored both instruction files to their pre-run state")
    }
    throw error
  }

  ctx.services.logger.change("Workflow models updated in Claude and Codex instructions")
  ctx.services.logger.warn("Start fresh Claude Code and Codex sessions before relying on the new workflow roles")
  ctx.nextStepTriggers.claudeRestart = true
  ctx.nextStepTriggers.codexRestart = true
}

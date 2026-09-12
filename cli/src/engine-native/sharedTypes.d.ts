/**
 * EngineNative shared shapes: each cross-cutting data shape is defined once
 * here so pipelines import one canonical definition instead of redeclaring
 * structurally identical anonymous types. Types only — no runtime code.
 */
import type { Json } from "./jq";
import type { ModifierFlag } from "./engineCtx";

/** Manifest-record object: the `{ [key]: Json }` shape redeclared across manifest readers. */
export type JsonObject = { [key: string]: Json }

/**
 * Shared core of per-tool settings-edit descriptors (Claude JSON modifiers,
 * Codex TOML passes). Each tool narrows `key` to its own vocabulary and keeps
 * tool-only fields (such as Claude's dry-run preview) on its local extension.
 */
export interface SettingEdit<TKey extends string> {
  readonly tag: string
  readonly key: TKey
  readonly value: string | undefined
  readonly changed: string
  readonly unchanged: string
}

/**
 * omp session model (moved from harnesses.ts, which re-exports it so existing
 * import paths keep working).
 */
export interface OmpSessionModel {
  readonly selector: string
  // Session ceiling; absent when the model publishes no ladder, so no
  // invented level ever reaches a selector that omp must resolve.
  readonly thinking?: string
  // Advisor level; absent when the model publishes no ladder.
  readonly advisorThinking?: string
}

/**
 * Scalar modifier flags: the ModifierFlag subset taking a value through
 * setModifier. Derived by exclusion so a new ModifierFlag forces an explicit
 * scalar/non-scalar decision here.
 */
export type ScalarModifierFlag = Exclude<ModifierFlag, "--claude-compact-window" | "--claude-permissive" | "--claude-plugin">

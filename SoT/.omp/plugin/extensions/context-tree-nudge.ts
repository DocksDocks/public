// omp extension: the context-tree nudge. After a file edit that did not fail, it adds a
// message that names each context-tree node that holds an edited file. The node rules live in
// `context-tree-core.mjs`; this file only takes the edited paths from the omp event and turns
// the answer of the core into an omp result.
//
// The edited paths come from the `details` of the tool result:
//   edit   `perFileResults[].path` and `.sourcePath` (each mode, also apply_patch), else `path`.
//   write  `resolvedPath`, but no URL target. A write to `xd://resolve` that applies an
//          ast_edit gives the files of the ast_edit, relative to the session folder.
// An ast_edit itself only previews, so it gets no nudge.
//
// The handler catches each error and adds nothing, because a nudge must not stop the work of
// the agent.
import path from 'node:path';
import { nudgeText } from './context-tree-core.mjs';

// The local structural types below name only the omp extension API parts that this module
// uses. The module does not import @oh-my-pi packages: they do not resolve outside omp.

interface ExtensionContext {
  readonly cwd: string;
}

interface ToolResultEvent {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly details?: unknown;
  readonly isError?: boolean;
}

interface ExtensionApi {
  on(
    event: 'tool_result',
    handler: (event: ToolResultEvent, ctx: ExtensionContext) => Promise<{ additionalContext: string } | undefined>,
  ): void;
}

// A tool path with a scheme, such as `local://notes.md` or `xd://bash`, names no file in a repository.
const URL_TARGET = /^[a-z][a-z0-9+.-]*:\/\//iu;

// The fields of an event value; undefined and null give no fields.
const record = (value: unknown): Record<string, unknown> => Object(value);

// The strings of one value or of a list of values.
const strings = (values: unknown): string[] =>
  (Array.isArray(values) ? values : [values]).filter((value): value is string => typeof value === 'string');

// The paths of an edit result: each file of a multi-file result, with the source of a move.
function editPaths(details: Record<string, unknown>): string[] {
  const perFile = details.perFileResults;
  if (Array.isArray(perFile))
    return strings(perFile.flatMap((result) => [record(result).path, record(result).sourcePath]));
  return strings(details.path);
}

// The paths of a write result. A write to a URL target names no file, but the result of a write to `xd://resolve`
// that applies an ast_edit names the files of the ast_edit.
function writePaths(input: Record<string, unknown>, details: Record<string, unknown>): string[] {
  if (!URL_TARGET.test(String(input.path))) return strings(details.resolvedPath);
  const inner = record(record(details.xdev).inner);
  if (inner.sourceToolName !== 'ast_edit' || inner.action !== 'apply') return [];
  return strings(record(inner.sourceResultDetails).files);
}

function editedPaths(event: ToolResultEvent): string[] {
  const details = record(event.details);
  if (event.toolName === 'edit') return editPaths(details);
  if (event.toolName === 'write') return writePaths(record(event.input), details);
  return [];
}

export default function contextTreeNudge(pi: ExtensionApi): void {
  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return undefined;
    try {
      const files = editedPaths(event).map((file) => path.resolve(ctx.cwd, file));
      const text = await nudgeText(files, ctx.cwd);
      return text === null ? undefined : { additionalContext: text };
    } catch {
      return undefined;
    }
  });
}

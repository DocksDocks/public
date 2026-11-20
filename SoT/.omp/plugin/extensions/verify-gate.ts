// omp extension: the verify-gate. Before each call of the bash tool, it checks that each
// `git commit` in the command carries a `Verified:` trailer. The rules live in
// `verify-gate-core.ts`; this file only turns the omp event into a call of the core and the
// answer of the core into an omp result. The gate sees only commits that run through the
// bash tool (also through `xd://bash` and `eval` `tool.bash`).
//
// omp blocks a tool call when its handler throws or runs longer than 30 s. But an internal error
// of the gate must not stop the work of the agent, so the handler catches each error and allows
// the command. The core throws when a check runs longer than its 20 s deadline, so a slow check
// also allows the command. The handler prints nothing, because output of the omp process goes to
// the user's terminal.
import path from 'node:path';
import { checkCommand } from './verify-gate-core.ts';

// The local structural types below name only the omp extension API parts that this module
// uses. The module does not import @oh-my-pi packages: they do not resolve outside omp.

interface ExtensionContext {
  readonly cwd: string;
  readonly sessionManager?: { getSessionId(): string | undefined };
}

interface ToolCallEvent {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

interface ToolCallResult {
  block: true;
  reason: string;
}

interface ExtensionApi {
  on(
    event: 'tool_call',
    handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallResult | undefined>,
  ): void;
}

export default function verifyGate(pi: ExtensionApi): void {
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash') return undefined;
    try {
      const command = event.input?.command;
      if (typeof command !== 'string') return undefined;
      const inputCwd = event.input?.cwd;
      const cwd = path.resolve(ctx.cwd, typeof inputCwd === 'string' ? inputCwd : '.');
      const sessionId = ctx.sessionManager?.getSessionId() || 'unknown';
      const reason = await checkCommand({ command, cwd, sessionId, env: process.env });
      return reason === null ? undefined : { block: true, reason };
    } catch {
      return undefined;
    }
  });
}

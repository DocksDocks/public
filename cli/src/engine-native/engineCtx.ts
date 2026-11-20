/**
 * EngineNative run context: the shared `Ctx` shape plus its construction from
 * the environment. Split from index.ts, which re-exports the public surface
 * so existing import paths keep working.
 */
import { engineHome } from "./ompSession";
import type { TerminalLease } from "./logger";
import type { BunRuntimeState } from "./bun";
import { kitHome } from "../kitHome";
import type { EngineServices } from "./services";

export interface Ctx {
  readonly repoDir: string;
  readonly home: string;
  dryRun: boolean;
  verbose: boolean;
  skipPluginRefresh?: boolean;
  /** Injected capability seam (logger/deps/platform) — see services.ts. */
  readonly services: EngineServices;
  terminalLease?: TerminalLease;
  bunRuntime?: Promise<BunRuntimeState>;
  /** Per-run next-step triggers (Output Policy): advice prints only when its trigger changed or --verbose. */
  readonly nextStepTriggers: {
    ompRestart: boolean;
  };
  /** Harness-CLI operations that failed this run; a non-empty list fails the sync. */
  readonly failures: Array<string>;
}

export interface CtxOptions {
  /**
   * True only on the harness-private native-raw channel: seed `Ctx` from the
   * unprefixed env globals DRY_RUN and DOCKS_KIT_VERBOSE
   * (the historical ${VAR:-default} contract). The public CLI takes the same
   * behavior from flags.
   */
  readonly envGlobals: boolean;
}

/**
 * Build the run context. HOME applies on every path;
 * the env globals apply only when `options.envGlobals` is true.
 */
export function makeCtx(services: EngineServices, options: CtxOptions): Ctx {
  const env = process.env;
  const home = engineHome(env);
  const globals: NodeJS.ProcessEnv = options.envGlobals ? env : {};
  return {
    repoDir: kitHome(),
    home,
    dryRun: globals["DRY_RUN"] === "1",
    verbose: globals["DOCKS_KIT_VERBOSE"] === "1",
    skipPluginRefresh: false,
    services,
    nextStepTriggers: {
      ompRestart: false,
    },
    failures: [],
  };
}

/**
 * EngineNative — the supported sync/model/toolchain engine.
 *
 * Golden suites drive it through main.ts's harness-private `native-raw`
 * channel, which bypasses @effect/cli so tests see the internal argv
 * vocabulary directly.
 *
 * Split: run context lives in `engineCtx.ts`, scheduling in
 * `syncConcurrency.ts`, and pipeline dispatch in `syncDispatch.ts`. This
 * module keeps the entry routing and re-exports the public surface so
 * existing import paths keep working.
 */
import { makeCtx, type Ctx } from "./engineCtx";
import { modeModel, modeToolchain } from "./modes";
import { ExitError } from "./parseArgs";
import { makeEngineServices, type EngineServices, type Logger } from "./services";
import { engineSync } from "./syncDispatch";

export type { Ctx, ModifierFlag } from "./engineCtx";
export { runBounded, syncConcurrencyForManifest } from "./syncConcurrency";
export type { SyncConcurrency, SyncTask } from "./syncConcurrency";

export async function runEngineNative(
  argv: ReadonlyArray<string>,
  services?: EngineServices,
): Promise<number> {
  let ctx!: Ctx;
  const baseServices = services ?? makeEngineServices();
  const baseLogger = baseServices.logger;
  const logger: Logger = {
    change: (msg) => baseLogger.change(msg),
    progress: (msg) => baseLogger.progress(msg),
    clearProgress: () => baseLogger.clearProgress(),
    verbose: (msg) => {
      if (ctx.verbose) baseLogger.verbose(msg);
    },
    warn: (msg) => baseLogger.warn(msg),
    err: (msg) => baseLogger.err(msg),
    echo: (line) => baseLogger.echo(line),
    acquireTerminal: (message) => baseLogger.acquireTerminal(message),
  };
  const runServices: EngineServices = {
    logger,
    deps: baseServices.deps,
    platform: baseServices.platform,
  };
  try {
    ctx = makeCtx(runServices);
    switch (argv[0]) {
      case "model":
        return modeModel(ctx, argv.slice(1));
      case "toolchain":
        return await modeToolchain(ctx, argv.slice(1));
      case "sync":
        return await engineSync(ctx, argv.slice(1));
      default:
        return await engineSync(ctx, argv);
    }
  } catch (e) {
    if (e instanceof ExitError) return e.code;
    throw e;
  }
}

/**
 * Failure ledger for harness-CLI operations. A kit-managed marketplace or
 * plugin command that exits non-zero is recorded here so engineSync can list
 * it and exit non-zero instead of reporting a clean sync.
 */
import type { Ctx } from "./index"

/**
 * Record a failed harness-CLI operation. The warning still prints immediately so
 * position in the output is preserved; the recorded message also lets engineSync
 * list the failure in the summary and exit non-zero.
 */
export function recordFailure(ctx: Ctx, message: string): void {
  ctx.failures.push(message)
  ctx.services.logger.warn(message)
}

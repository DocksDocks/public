/**
 * The wait-skipping hook of the `plan.mjs` entry. A case that runs a command
 * with `runSkippingWaits` loads this module through `node --import`, so the
 * waits of `reopen` and `archive` return at once and the suite stays fast;
 * the shipped helper keeps its real waits. Each skipped timeout is appended
 * to the file that `PLAN_CLI_WAIT_LOG` names, so a case can check which
 * pauses and settle wait the helper asked for.
 *
 * Node loads this file with type stripping, so it uses only erasable syntax.
 */
import fs from "node:fs";

const log = process.env["PLAN_CLI_WAIT_LOG"];

const skippedWait = (
  _typedArray: Int32Array | BigInt64Array,
  _index: number,
  _value: number | bigint,
  timeout?: number,
): "timed-out" => {
  if (log) fs.appendFileSync(log, `${timeout}\n`);
  return "timed-out";
};

Atomics.wait = skippedWait as typeof Atomics.wait;

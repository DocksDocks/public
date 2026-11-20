import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import config from "./pluginContent/config.json" with { type: "json" };
import { checkContentHashes, writeContentHashes } from "./pluginContent/contentHash.ts";

/**
 * Check or refresh `metadata.content_hash` of the kit plugin skills.
 *
 *   bun cli/scripts/skill-content-hash.ts --check [--root <skills dir>]
 *   bun cli/scripts/skill-content-hash.ts --write [--root <skills dir>]
 *
 * `--check` names each skill whose stored hash is missing or stale and exits 1
 * when there is one. `--write` refreshes the hash and `metadata.updated` of each
 * changed skill. The default root is the skills folder of the kit plugin.
 */
const USAGE = "usage: bun cli/scripts/skill-content-hash.ts --check|--write [--root <skills dir>]";
const DEFAULT_ROOT = resolve(import.meta.dirname, "..", "..", config.pluginDir, "skills");

function usage(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const modes = args.filter((arg) => arg === "--check" || arg === "--write");
if (modes.length !== 1) usage("give exactly one of --check and --write");
let root = DEFAULT_ROOT;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--check" || arg === "--write") continue;
  if (arg === "--root" && args[index + 1] !== undefined) {
    root = resolve(args[index + 1]!);
    index += 1;
    continue;
  }
  usage(`unknown argument: ${String(arg)}`);
}
if (!existsSync(root) || !statSync(root).isDirectory()) usage(`skills root not found: ${root}`);

if (modes[0] === "--check") {
  const stale = checkContentHashes(root);
  for (const { name, reason } of stale) console.error(`stale ${name} (${reason})`);
  if (stale.length > 0) {
    console.error(
      `${stale.length} skill(s) out of sync; run: bun cli/scripts/skill-content-hash.ts --write`,
    );
    process.exit(1);
  }
  console.log(`content hashes in sync: ${root}`);
} else {
  const written = writeContentHashes(root);
  for (const name of written) console.log(`wrote ${name}`);
  console.log(`${written.length} skill(s) refreshed: ${root}`);
}

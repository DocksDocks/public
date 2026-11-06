/**
 * docks-kit-omp extension: plugin upgrade reminders for omp sessions.
 *
 * omp deletes the previous plugin folder on `omp plugin upgrade`. A running
 * omp session keeps the plugin agents that it found at startup. So these
 * agents can fail after an upgrade, until the user runs /reload-plugins. The
 * skills of the session resolve to the new folder through `skill://`.
 * `docks-kit sync` writes one event file for each upgrade that changed a
 * version, or that can have changed it (the version `unknown`).
 *
 * In each tool_result of a main session, this extension reads the events that
 * finished after this omp process started. It adds one reminder for the events
 * that the session did not get before. A folder or file that it cannot read
 * gives no reminder for that tool result. The next tool result reads it again.
 *
 * The module imports only node: modules, so omp loads it without a package
 * install.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ------------------------------------------------------------- constants ----

/**
 * The start of this omp process. omp finds the plugin folders before it
 * imports extension modules, so a later upgrade can remove a loaded folder.
 */
const PROCESS_START_MS = Date.now() - process.uptime() * 1000;

/** An event file name that `docks-kit sync` writes; a temporary name does not match. */
const EVENT_FILE = /^\d+-[0-9a-f]+\.json$/;
/** A plugin id or version that the reminder can name without a quote. */
const SAFE_TOKEN = /^[A-Za-z0-9._@+-]+$/;

// ----------------------------------------------------------- omp API types ----

// The local structural types below name only the omp extension API parts
// that this module uses. The module does not import @oh-my-pi packages.

interface ExtensionContext {
  readonly agent?: { readonly kind: "main" | "sub" };
  readonly sessionManager?: { getSessionId(): string };
}

export interface ExtensionApi {
  on(
    event: "tool_result",
    handler: (
      event: unknown,
      ctx: ExtensionContext,
    ) => Promise<{ additionalContext: string } | undefined>,
  ): void;
}

// ---------------------------------------------------------------- events ----

/** One plugin upgrade that `docks-kit sync` recorded. */
export interface PluginUpgradeEvent {
  readonly id: string;
  readonly before: string;
  readonly after: string;
  /** The time in milliseconds just after the upgrade command returned. */
  readonly finishedAtMs: number;
}

/** The upgrade log folder; `ompPlugins.ts syncPlugins` in the docks-kit CLI writes it. */
export function upgradeLogDir(home: string): string {
  return join(home, ".cache", "docks-kit", "omp-plugin-upgrades");
}

/** The event in one event file, or undefined when the file is not a version 1 event. */
export function parseUpgradeEvent(text: string): PluginUpgradeEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { version, id, before, after, finishedAt } = value as Record<string, unknown>;
  if (version !== 1) return undefined;
  if (typeof id !== "string" || typeof before !== "string" || typeof after !== "string") {
    return undefined;
  }
  if (![id, before, after].every((token) => SAFE_TOKEN.test(token))) return undefined;
  const finishedAtMs = typeof finishedAt === "string" ? Date.parse(finishedAt) : Number.NaN;
  if (!Number.isFinite(finishedAtMs)) return undefined;
  return { id, before, after, finishedAtMs };
}

/** The reminder that names each upgrade. */
export function upgradeReminder(events: ReadonlyArray<PluginUpgradeEvent>): string {
  const upgrades = events.map((event) => `${event.id} ${event.before} -> ${event.after}`);
  return [
    `docks-kit sync upgraded these omp plugins after this omp process started: ${upgrades.join(", ")}.`,
    "omp removes the old plugin folder on upgrade, so this session's plugin agents may fail.",
    "Ask the user to run /reload-plugins in this session, then read each plugin skill again through skill:// before you run its scripts.",
    "Ask the user to restart omp instead when an upgraded plugin ships hooks, extension modules, or non-MCP tools.",
  ].join(" ");
}

// ------------------------------------------------------------- extension ----

export interface PluginUpgradesOptions {
  /** The home folder that holds the upgrade log. */
  readonly home: string;
  /** Events that finished at or before this time give no reminder. */
  readonly processStartMs: number;
}

/** The extension factory for one home folder and one process start. */
export function pluginUpgrades(options: PluginUpgradesOptions): (pi: ExtensionApi) => void {
  const dir = upgradeLogDir(options.home);
  /** Each event file read so far; undefined marks a file whose content is not an event. */
  const read = new Map<string, PluginUpgradeEvent | undefined>();
  /** For each session id, the event files that its reminders named. */
  const told = new Map<string, Set<string>>();

  /** The events of the log. Each file name is read until one read succeeds. */
  function currentEvents(): Array<{ name: string; event: PluginUpgradeEvent }> {
    let names: Array<string>;
    try {
      names = readdirSync(dir).filter((name) => EVENT_FILE.test(name));
    } catch {
      // A missing folder holds no events. Another error gives no events now,
      // and the next tool result reads the folder again.
      return [];
    }
    const present = new Set(names);
    // Sync prunes old files, so the cache forgets the names that are gone.
    for (const name of read.keys()) if (!present.has(name)) read.delete(name);
    const events: Array<{ name: string; event: PluginUpgradeEvent }> = [];
    for (const name of names) {
      if (!read.has(name)) {
        let text: string;
        try {
          text = readFileSync(join(dir, name), "utf8");
        } catch {
          // A prune removed the file (ENOENT), or the read failed for now.
          // The name stays out of the cache, so the next tool result reads it again.
          continue;
        }
        read.set(name, parseUpgradeEvent(text));
      }
      const event = read.get(name);
      if (event !== undefined) events.push({ name, event });
    }
    return events;
  }

  return (pi) => {
    pi.on("tool_result", async (_event, ctx) => {
      try {
        if (ctx.agent?.kind !== "main") return undefined;
        const sessionId = ctx.sessionManager?.getSessionId();
        if (sessionId === undefined || sessionId === "") return undefined;
        const toldSession = told.get(sessionId) ?? new Set<string>();
        const fresh = currentEvents()
          .filter(
            ({ name, event }) =>
              event.finishedAtMs > options.processStartMs && !toldSession.has(name),
          )
          .sort(
            (a, b) => a.event.finishedAtMs - b.event.finishedAtMs || (a.name < b.name ? -1 : 1),
          );
        if (fresh.length === 0) return undefined;
        for (const { name } of fresh) toldSession.add(name);
        told.set(sessionId, toldSession);
        return { additionalContext: upgradeReminder(fresh.map(({ event }) => event)) };
      } catch {
        return undefined;
      }
    });
  };
}

export default function docksKitPluginUpgrades(pi: ExtensionApi): void {
  pluginUpgrades({ home: homedir(), processStartMs: PROCESS_START_MS })(pi);
}

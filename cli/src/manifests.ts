import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pluginUserScopeInstalled } from "./engine-native/claudePluginPasses";
import { codexHome } from "./engine-native/codexPaths";
import { engineHome } from "./engine-native/harnesses";
import { isObject, readJsonFile } from "./engine-native/jq";
import type { JsonObject } from "./engine-native/sharedTypes";
import { skillBase } from "./engine-native/skillsManifest";
import { COPY_MARKER } from "./engine-native/skillsSync";
import { payloadText } from "./payload";

export type Tool = "claude" | "codex";

const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const readJsonText = (text: string): any => JSON.parse(text);

/** SoT settings (claude) — model/effort/env for drift display. */
export const sotClaudeSettings = (): any => readJsonText(payloadText("SoT/.claude/settings.json"));

export const deployedClaudeSettings = (): any | undefined => {
  const p = join(engineHome(), ".claude", "settings.json");
  return existsSync(p) ? readJson(p) : undefined;
};

export function topLevelTomlString(text: string, setting: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) return undefined;
    const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|'([^']*)')/);
    if (assignment?.[1] === setting) return assignment[2] ?? assignment[3];
  }
  return undefined;
}

const tomlModel = (path: string): string | undefined => {
  if (!existsSync(path)) return undefined;
  return topLevelTomlString(readFileSync(path, "utf8"), "model");
};

export const sotCodexModel = (): string | undefined =>
  topLevelTomlString(payloadText("SoT/.codex/config.toml"), "model");

export const deployedCodexModel = (): string | undefined =>
  tomlModel(join(codexHome(engineHome()), "config.toml"));

const installedPluginsPath = (): string =>
  join(engineHome(), ".claude", "plugins", "installed_plugins.json");

/** Read the user-scope plugin records; a missing or malformed file yields `undefined`. */
const readInstalledPlugins = (path: string): JsonObject | undefined => {
  const doc = readJsonFile(path);
  if (doc === undefined || !isObject(doc)) return undefined;
  const plugins = doc["plugins"];
  return plugins !== undefined && isObject(plugins) ? plugins : undefined;
};

/** State of ~/.claude/plugins/installed_plugins.json: missing, an object with object `plugins`, or not. */
export const installedPluginsState = (): "absent" | "valid" | "malformed" => {
  const path = installedPluginsPath();
  if (!existsSync(path)) return "absent";
  return readInstalledPlugins(path) === undefined ? "malformed" : "valid";
};

/** Installed plugins (user scope) vs SoT enabledPlugins tri-state. */
export const pluginsView = (): Array<{
  plugin: string;
  sot: "true" | "false" | "absent";
  installed: boolean;
}> => {
  const sot: Record<string, boolean> = sotClaudeSettings().enabledPlugins ?? {};
  const installedPath = installedPluginsPath();
  const installed: Record<string, unknown> = readInstalledPlugins(installedPath) ?? {};
  const names = new Set([...Object.keys(sot), ...Object.keys(installed)]);
  return [...names].sort().map((plugin) => ({
    plugin,
    sot: plugin in sot ? (sot[plugin] ? "true" : "false") : "absent",
    installed: pluginUserScopeInstalled(installedPath, plugin),
  }));
};

/** Universal skills: SoT manifest slugs vs ~/.agents/skills contents. */
export const skillsView = (): Array<{
  skill: string;
  declared: boolean;
  installed: boolean;
  /** Claude entry resolves to the canonical skill by symlink, junction, or kit-created copy. */
  claudeSymlink: boolean;
}> => {
  const declared = payloadText("SoT/.agents/skills.txt")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0)
    .map(skillBase);
  const home = engineHome();
  const skillsDir = join(home, ".agents", "skills");
  const installed = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];
  const names = new Set([...declared, ...installed]);
  return [...names].sort().map((skill) => {
    const link = join(home, ".claude", "skills", skill);
    const canonical = resolve(skillsDir, skill);
    let claudeSymlink = false;
    try {
      const target = resolve(dirname(link), readlinkSync(link));
      claudeSymlink = target === canonical && existsSync(target);
    } catch {
      /* not a symlink or missing */
    }
    if (!claudeSymlink && installed.includes(skill)) {
      try {
        claudeSymlink = lstatSync(link).isDirectory() && existsSync(join(link, COPY_MARKER));
      } catch {
        /* missing Claude entry */
      }
    }
    return {
      skill,
      declared: declared.includes(skill),
      installed: installed.includes(skill),
      claudeSymlink,
    };
  });
};

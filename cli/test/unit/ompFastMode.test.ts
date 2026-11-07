import { afterEach, describe, expect, it } from "vitest";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import { toggleDeployedOpenAiFast, toggleOpenAiFast } from "../../src/engine-native/ompFastMode";
import { mergeOmpConfig } from "../../src/engine-native/ompYaml";
import { payloadText } from "../../src/payload";

const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CONFIG = `# user note
tier:
  openai: none
  anthropic: none

advisor:
  enabled: true
`;

describe("toggleOpenAiFast", () => {
  it("turns fast on and changes only tier.openai", () => {
    const toggle = toggleOpenAiFast(CONFIG);
    expect(toggle).toMatchObject({ previous: "none", next: "priority" });
    expect(toggle.text).toBe(CONFIG.replace("openai: none", "openai: priority"));
  });

  it("turns fast off when tier.openai is priority", () => {
    const toggle = toggleOpenAiFast(toggleOpenAiFast(CONFIG).text);
    expect(toggle).toMatchObject({ previous: "priority", next: "none" });
    expect(toggle.text).toBe(CONFIG);
  });

  it("replaces ultrafast with plain fast instead of turning off", () => {
    const toggle = toggleOpenAiFast(CONFIG.replace("openai: none", "openai: ultrafast"));
    expect(toggle).toMatchObject({ previous: "ultrafast", next: "priority" });
  });

  it("treats a missing tier block as off and creates it", () => {
    const toggle = toggleOpenAiFast("advisor:\n  enabled: true\n");
    expect(toggle).toMatchObject({ previous: "none", next: "priority" });
    expect(parse(toggle.text)).toEqual({
      advisor: { enabled: true },
      tier: { openai: "priority" },
    });
  });

  it("rejects a tier key that is not a mapping", () => {
    expect(() => toggleOpenAiFast("tier: fast\n")).toThrow(
      "omp config.yml key 'tier' must be a mapping",
    );
  });

  it("survives a sync merge with the shipped SoT config", () => {
    const deployed = toggleOpenAiFast(CONFIG).text;
    const merged = parse(mergeOmpConfig(payloadText("SoT/.omp/config.yml"), deployed));
    expect(merged.tier.openai).toBe("priority");
  });
});

describe("toggleDeployedOpenAiFast", () => {
  it("keeps a symlinked config.yml a link", () => {
    const root = mkdtempSync(join(tmpdir(), "omp-fast-link-"));
    roots.push(root);
    const dotfiles = join(root, "dotfiles");
    mkdirSync(dotfiles);
    const linkTarget = join(dotfiles, "config.yml");
    writeFileSync(linkTarget, CONFIG);
    const configPath = join(root, "config.yml");
    symlinkSync(linkTarget, configPath);

    const toggle = toggleDeployedOpenAiFast(configPath);

    expect(toggle).toMatchObject({ previous: "none", next: "priority" });
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(parse(readFileSync(linkTarget, "utf8")).tier.openai).toBe("priority");
  });
});

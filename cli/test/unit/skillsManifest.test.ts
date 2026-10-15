import { describe, expect, it } from "vitest";

import { skillBase } from "../../src/engine-native/skillsManifest";

describe("skillBase", () => {
  it.each([
    ["acme/pack@Demo", "demo"],
    ["acme/pack@My.Skill!", "my.skill"],
    ["acme/demo", "demo"],
    ["https://github.com/acme/pack/tree/main/skills/foo", "foo"],
  ])("names the directory the skills CLI installs for %s", (slug, base) => {
    expect(skillBase(slug)).toBe(base);
  });

  // Prune deletes ~/.agents/skills/<base>, so an `@` outside the CLI's
  // <owner>/<repo>@<skill> form must never select a different skill directory.
  it.each([
    ["/tmp/my@demo", "my-demo"],
    ["./skills/x@y", "x-y"],
    ["git@github.com:acme/pack", "pack"],
  ])("keeps an @ that the skills CLI does not parse in %s", (slug, base) => {
    expect(skillBase(slug)).toBe(base);
  });
});

import { describe, expect, it } from "vitest";

import { mergeSettings, reconcileSettings } from "../../src/engine-native/settings";

describe("settings merge contract", () => {
  it("updates conflicting settings without losing user-only nested keys or hooks", () => {
    expect(
      mergeSettings(
        {
          model: "kit",
          env: { SHARED: "kit", KIT_ONLY: "kit" },
          hooks: { SessionStart: ["kit"] },
        },
        {
          model: "user",
          env: { SHARED: "user", USER_ONLY: "user" },
          hooks: { SessionStart: ["user"], SubagentStop: ["user"] },
          customSetting: true,
        },
      ),
    ).toEqual({
      model: "kit",
      env: { SHARED: "kit", KIT_ONLY: "kit", USER_ONLY: "user" },
      hooks: { SessionStart: ["kit"], SubagentStop: ["user"] },
      customSetting: true,
      permissions: { allow: [], deny: [], ask: [] },
    });
  });

  it("unions and sorts all permission lists while preserving user-only permission settings", () => {
    expect(
      mergeSettings(
        {
          permissions: {
            defaultMode: "auto",
            allow: ["Read", "Edit(./)"],
            deny: ["Read(**/.env)"],
            ask: ["Bash(git push *)"],
          },
        },
        {
          permissions: {
            defaultMode: "ask",
            allow: ["Read", "Glob", null, 42],
            deny: ["Read(**/secrets/**)", "Read(**/.env)"],
            ask: ["Bash(git push *)", "Bash(git commit *)"],
            additionalDirectories: ["/work"],
          },
        },
      ),
    ).toEqual({
      permissions: {
        defaultMode: "auto",
        allow: ["Edit(./)", "Glob", "Read"],
        deny: ["Read(**/.env)", "Read(**/secrets/**)"],
        ask: ["Bash(git commit *)", "Bash(git push *)"],
        additionalDirectories: ["/work"],
      },
    });
  });

  it("replaces kit-owned permission lists on reconcile but retains user-only settings", () => {
    expect(
      reconcileSettings(
        {
          permissions: {
            defaultMode: "auto",
            allow: ["Read"],
            deny: [],
            ask: ["Bash(git push *)"],
          },
          env: { SHARED: "kit" },
        },
        {
          permissions: {
            defaultMode: "ask",
            allow: ["Write"],
            deny: ["Bash(sudo *)"],
            ask: ["Bash(ssh *)"],
            additionalDirectories: ["/work"],
          },
          env: { SHARED: "user", USER_ONLY: "user" },
          customSetting: true,
        },
      ),
    ).toEqual({
      permissions: {
        defaultMode: "auto",
        allow: ["Read"],
        deny: [],
        ask: ["Bash(git push *)"],
        additionalDirectories: ["/work"],
      },
      env: { SHARED: "kit", USER_ONLY: "user" },
      customSetting: true,
    });
  });

  it("creates empty permission lists when both settings files omit them", () => {
    expect(
      mergeSettings({ permissions: { defaultMode: "auto" } }, { env: { USER_ONLY: "user" } }),
    ).toEqual({
      env: { USER_ONLY: "user" },
      permissions: { defaultMode: "auto", allow: [], deny: [], ask: [] },
    });
  });
});

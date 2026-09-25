import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { kitHome, resolveKitHome } from "../../src/kitHome";

const createKitRoot = (dir: string, ...nestedDirs: string[]): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"name":"docks-kit"}');
  for (const nestedDir of nestedDirs) {
    mkdirSync(join(dir, nestedDir), { recursive: true });
  }
};

describe("kitHome", () => {
  it("rejects a misidentified DOCKS_KIT_HOME rather than falling back to the install", () => {
    const dir = mkdtempSync(join(tmpdir(), "docks-kit-home-"));
    writeFileSync(join(dir, "package.json"), '{"name":"another-package"}');
    const previous = process.env["DOCKS_KIT_HOME"];
    process.env["DOCKS_KIT_HOME"] = dir;
    try {
      expect(() => kitHome()).toThrow(/is not a docks-kit package root/);
    } finally {
      if (previous === undefined) delete process.env["DOCKS_KIT_HOME"];
      else process.env["DOCKS_KIT_HOME"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["a missing manifest", undefined, /does not contain package\.json/],
    ["invalid JSON", "{", /contains invalid JSON/],
  ] as const)(
    "rejects an explicit home with %s even when an install exists",
    (_case, manifest, error) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-home-")));
      try {
        const invalidRoot = join(dir, "invalid");
        const validRoot = join(dir, "valid");
        mkdirSync(invalidRoot);
        createKitRoot(validRoot, "cli/src");
        if (manifest !== undefined) writeFileSync(join(invalidRoot, "package.json"), manifest);

        expect(() =>
          resolveKitHome({
            env: invalidRoot,
            moduleDir: join(validRoot, "cli", "src"),
            execPath: join(validRoot, "bin", "docks-kit"),
            cwd: validRoot,
          }),
        ).toThrow(error);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("resolveKitHome", () => {
  it("prefers a valid DOCKS_KIT_HOME over every automatic source", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")));
    try {
      const envRoot = join(dir, "env");
      const moduleRoot = join(dir, "module");
      const execRoot = join(dir, "exec");
      const cwdRoot = join(dir, "cwd");
      createKitRoot(envRoot);
      createKitRoot(moduleRoot, "src/runtime");
      createKitRoot(execRoot, "bin");
      createKitRoot(cwdRoot, "work/tree");

      expect(
        resolveKitHome({
          env: envRoot,
          moduleDir: join(moduleRoot, "src", "runtime"),
          execPath: join(execRoot, "bin", "docks-kit"),
          cwd: join(cwdRoot, "work", "tree"),
        }),
      ).toBe(envRoot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a blank DOCKS_KIT_HOME and prefers the running install over the checkout", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")));
    try {
      const installRoot = join(dir, "install");
      const checkoutRoot = join(dir, "checkout");
      createKitRoot(installRoot, "cli/src");
      createKitRoot(checkoutRoot, "work/tree");

      expect(
        resolveKitHome({
          env: "",
          moduleDir: join(installRoot, "cli", "src"),
          execPath: join(dir, "bin", "docks-kit"),
          cwd: join(checkoutRoot, "work", "tree"),
        }),
      ).toBe(installRoot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the exec path over cwd when the module path is virtual or absent", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")));
    try {
      const root = join(dir, "checkout");
      const cwdRoot = join(dir, "outside");
      createKitRoot(root, "cli/dist");
      createKitRoot(cwdRoot, "work/tree");

      for (const moduleDir of ["/$bunfs/root", undefined]) {
        expect(
          resolveKitHome({
            env: undefined,
            moduleDir,
            execPath: join(root, "cli", "dist", "docks-kit-linux-x64"),
            cwd: join(cwdRoot, "work", "tree"),
          }),
        ).toBe(root);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a non-kit module package and finds the working directory kit root", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")));
    try {
      const cwdRoot = join(dir, "checkout");
      const unrelatedRoot = join(dir, "unrelated");
      createKitRoot(cwdRoot, "work/tree");
      mkdirSync(join(unrelatedRoot, "lib"), { recursive: true });
      writeFileSync(join(unrelatedRoot, "package.json"), '{"name":"other-package"}');

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(unrelatedRoot, "lib"),
          execPath: join(dir, "bin", "docks-kit"),
          cwd: join(cwdRoot, "work", "tree"),
        }),
      ).toBe(cwdRoot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the exec path directory when no kit root exists", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")));
    try {
      const execPath = join(dir, "runtime", "docks-kit");

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(dir, "virtual", "module"),
          execPath,
          cwd: join(dir, "work", "tree"),
        }),
      ).toBe(dirname(execPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the nearest kit root ancestor", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")));
    try {
      const outerRoot = join(dir, "outer");
      const innerRoot = join(outerRoot, "packages", "inner");
      createKitRoot(outerRoot);
      createKitRoot(innerRoot, "cli/src");

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(innerRoot, "cli", "src"),
          execPath: join(dir, "bin", "docks-kit"),
          cwd: join(dir, "work", "tree"),
        }),
      ).toBe(innerRoot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

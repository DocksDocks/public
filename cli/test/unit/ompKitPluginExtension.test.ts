import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import docksKitOmp, {
  claimSweep,
  cleanupCommand,
  creationReminder,
  detectResources,
  resolveDocksKit,
  run,
  splitShellSegments,
  stopReminder,
  sweepDue,
  type DockerTarget,
  type ExtensionApi,
  type HygieneResource,
} from "../../../SoT/.omp/plugin/extensions/hygiene.ts";
import { BUN_RUNTIME } from "../lib/cliEntry";

const EXTENSION = resolve(import.meta.dirname, "../../../SoT/.omp/plugin/extensions/hygiene.ts");
const HOME = resolve("/h");
const HOUR_MS = 60 * 60 * 1000;
const CONTAINER_ID = "0123456789abcdef".repeat(4);
const SHORT_ID = CONTAINER_ID.slice(0, 12);
const DEFAULT_DAEMON: DockerTarget = { environment: {}, options: [] };
const roots: Array<string> = [];

function sandbox(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-hygiene-")));
  roots.push(root);
  return root;
}

function detect(command: string, cwd = "/w", output = "") {
  return detectResources(command, resolve(cwd), output, HOME);
}

function categories(command: string): Array<string> {
  return detect(command).resources.flatMap((resource) =>
    resource.kind === "other" ? [resource.category] : [],
  );
}

function worktrees(command: string): Array<string> {
  return detect(command).resources.flatMap((resource) =>
    resource.kind === "worktree" ? [resource.path] : [],
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("splitShellSegments", () => {
  it("removes quotes and splits on control operators", () => {
    expect(splitShellSegments(`a 'b c' "d\\"e" && f || g; h | i &`)).toEqual([
      { words: ["a", "b c", 'd"e'], background: false },
      { words: ["f"], background: false },
      { words: ["g"], background: false },
      { words: ["h"], background: false },
      { words: ["i"], background: true },
    ]);
  });

  it("keeps a redirection to a file descriptor in the word", () => {
    expect(splitShellSegments("make > log 2>&1 &")).toEqual([
      { words: ["make", ">", "log", "2>&1"], background: true },
    ]);
  });

  it("puts a command substitution before its segment", () => {
    expect(splitShellSegments("S=$(docks-kit scratch new x)")).toEqual([
      { words: ["docks-kit", "scratch", "new", "x"], background: false },
      { words: ["S=$(docks-kit scratch new x)"], background: false },
    ]);
  });

  it("skips a heredoc body", () => {
    expect(splitShellSegments("cat > f <<'EOF'\ndon't run & this\nEOF\necho done")).toEqual([
      { words: ["cat", ">", "f", "<<EOF"], background: false },
      { words: ["echo", "done"], background: false },
    ]);
  });
});

describe("detectResources", () => {
  it("finds a worktree relative to the working directory", () => {
    expect(detect("git worktree add -b feat ../wt main", "/r/main").resources).toEqual([
      { kind: "worktree", path: resolve("/r/main", "../wt") },
    ]);
  });

  it("finds a worktree with git -C", () => {
    expect(detect("git -C /r/main worktree add /w/x").resources).toEqual([
      { kind: "worktree", path: resolve("/w/x") },
    ]);
  });

  it("follows cd before a worktree add", () => {
    expect(detect("cd /a && git worktree add b").resources).toEqual([
      { kind: "worktree", path: resolve("/a", "b") },
    ]);
  });

  it("treats --orphan as a flag", () => {
    expect(detect("git worktree add --orphan -b fresh ../o").resources).toEqual([
      { kind: "worktree", path: resolve("/w", "../o") },
    ]);
  });

  it("gives a generic note for a worktree path that is not literal", () => {
    const result = detect('git worktree add "$WT"');
    expect(result.resources).toEqual([]);
    expect(result.notes).toEqual([
      "You created a git worktree. When the task no longer needs it, run `git worktree remove -- <path>`.",
    ]);
  });

  it("ignores git worktree list", () => {
    expect(detect("git worktree list")).toEqual({ resources: [], notes: [] });
  });

  it("finds a compose project from its first file", () => {
    const [resource] = detect("docker compose -f /x/docker-compose.yml up -d").resources;
    expect(resource?.kind).toBe("compose");
    if (resource?.kind !== "compose") return;
    expect(resource.workingDir).toBe(resolve("/x"));
    if (process.platform !== "win32") {
      expect(resource.down).toContain("-f /x/docker-compose.yml down");
    }
  });

  it("finds a compose project in the working directory", () => {
    const [resource] = detect("docker compose up -d", "/w").resources;
    expect(resource?.kind).toBe("compose");
    if (resource?.kind !== "compose") return;
    expect(resource.workingDir).toBe(resolve("/w"));
    expect(resource.down).toMatch(/^docker compose --project-directory .+ down$/);
  });

  it("finds a detached container from its id", () => {
    const result = detect("docker run -d --rm img", "/w", `${CONTAINER_ID}\n`);
    expect(result.resources).toEqual([
      { kind: "container", id: SHORT_ID, down: `docker stop ${SHORT_ID}`, docker: DEFAULT_DAEMON },
    ]);
    expect(result.notes).toEqual([]);
  });

  it("asks for --rm on docker run", () => {
    expect(detect("docker run img").notes).toEqual([
      "Add `--rm` to `docker run` so that Docker removes the container when it stops.",
    ]);
  });

  it("finds a scratch directory from the output", () => {
    const path = "/h/.cache/docks-kit/scratch/eval-ab12";
    expect(detect("docks-kit scratch new eval", "/w", `${path}\n`).resources).toEqual([
      { kind: "scratch", path },
    ]);
  });

  it("finds a mktemp directory and points to the scratch tools", () => {
    const path = join(tmpdir(), "tmp.X");
    const result = detect("mktemp -d", "/w", `${path}\n`);
    expect(result.resources).toEqual([{ kind: "tempDir", path }]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("scratch_new");
    expect(result.notes[0]).toContain("docks-kit scratch new");
  });

  it("finds a mktemp file, but not a dry-run name, and points to the scratch tools", () => {
    const path = join(tmpdir(), "tmp.Y");
    const result = detect("mktemp", "/w", `${path}\n`);
    expect(result.resources).toEqual([{ kind: "tempFile", path }]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("scratch_new");
    expect(detect("mktemp -u", "/w", `${join(tmpdir(), "tmp.Z")}\n`)).toEqual({
      resources: [],
      notes: [],
    });
  });

  it.each(["mktemp -du", "mktemp -d --dry-run", "mktemp --directory -u"])(
    "records nothing for %s, a dry run that creates nothing",
    (command) => {
      expect(detect(command, "/w", "/tmp/tmp.Z\n")).toEqual({ resources: [], notes: [] });
    },
  );

  it("names a temporary file when the mktemp path is not in the output", () => {
    const result = detect("f=$(mktemp)");
    expect(result.resources).toEqual([]);
    const fileNote = result.notes.find((note) => note.includes("a temporary file"));
    expect(fileNote).toContain("docks-kit scratch remove <path>");
  });

  it("does not take another command's output for a captured mktemp file", () => {
    const other = join(tmpdir(), "other-task");
    const result = detect(`f=$(mktemp); printf '%s\\n' "$OTHER"`, "/w", `${other}\n`);
    expect(result.resources).toEqual([]);
    const fileNote = result.notes.find((note) => note.includes("a temporary file"));
    expect(fileNote).toContain("docks-kit scratch remove <path>");
  });

  it("does not take another command's output for a captured scratch directory", () => {
    const other = join(tmpdir(), "other-task");
    const result = detect('S=$(docks-kit scratch new x); echo "$OTHER"', "/w", `${other}\n`);
    expect(result.resources).toEqual([]);
    expect(result.notes.some((note) => note.includes("scratch directory"))).toBe(true);
  });

  it.each([
    ["mktemp > >(sed 's@.*@/tmp/other-task@')", "a temporary file"],
    ["docks-kit scratch new x > >(sed 's@.*@/tmp/other-task@')", "a scratch directory"],
  ])("does not take redirected output for %s", (command, noun) => {
    const result = detect(command, "/w", `${join(tmpdir(), "other-task")}\n`);
    expect(result.resources).toEqual([]);
    expect(result.notes.some((note) => note.includes(noun))).toBe(true);
  });

  it.each([
    "mktemp --suffix -upload",
    "mktemp --s -upload",
    "mktemp --suffix -dir",
    "mktemp -- -dXXXXXX",
  ])("reads the options of %s, not an option value or the template", (command) => {
    const path = join(tmpdir(), "tmp.V");
    expect(detect(command, "/w", `${path}\n`).resources).toEqual([{ kind: "tempFile", path }]);
  });

  it("reads the -t prefix of macOS mktemp as a value", () => {
    const path = join(tmpdir(), "upload.V");
    const result = detectResources("mktemp -tupload", resolve("/w"), `${path}\n`, HOME, "darwin");
    expect(result.resources).toEqual([{ kind: "tempFile", path }]);
  });

  it("does not take the output of a command that a wrapper runs", () => {
    const result = detect(
      `env -a mktemp printf '%s\\n' "$OTHER"`,
      "/w",
      `${join(tmpdir(), "other-task")}\n`,
    );
    expect(result.resources).toEqual([]);
    expect(result.notes.some((note) => note.includes("temporary file"))).toBe(false);
  });

  it.each([
    "env -S true git worktree add /tmp/existing",
    "env -C /srv/new docker compose up -d",
    "env --chdir /srv/new docker compose up -d",
    "sudo -D /srv/new docker compose up -d",
    "sudo -i docker compose up -d",
  ])(
    "records nothing for %s, whose wrapper option can change the command or its directory",
    (command) => {
      expect(detect(command, "/srv/old").resources).toEqual([]);
    },
  );

  it.each([
    ["npm run dev &", "background process"],
    ["nohup srv", "background process"],
    ["kind create cluster", "cluster or virtual machine"],
    ["ssh -fN -L 5432:db:5432 host", "tunnel"],
    ["bun add -g x", "global install"],
    ["supabase branches create t", "remote resource"],
    ["git stash", "git stash"],
    ["disown -h %1", "background process"],
  ])("puts %s in the category %s", (command, category) => {
    expect(categories(command)).toEqual([category]);
  });

  it("ignores git stash list", () => {
    expect(detect("git stash list")).toEqual({ resources: [], notes: [] });
  });
});

describe("Docker daemon targets", () => {
  function compose(command: string): Extract<HygieneResource, { kind: "compose" }> | undefined {
    const [resource] = detect(command).resources;
    return resource?.kind === "compose" ? resource : undefined;
  }

  function container(command: string): Extract<HygieneResource, { kind: "container" }> | undefined {
    const [resource] = detect(command, "/w", `${CONTAINER_ID}\n`).resources;
    return resource?.kind === "container" ? resource : undefined;
  }

  it.each([
    ["docker --context dev compose -p app up -d", ["--context", "dev"]],
    ["docker -c dev compose -p app up -d", ["--context", "dev"]],
    ["docker --context=dev compose -p app up -d", ["--context", "dev"]],
    ["docker -l debug --host=ssh://u@h compose -p app up -d", ["--host", "ssh://u@h"]],
    [
      "docker --tlsverify -H tcp://h:2376 compose -p app up -d",
      ["--tlsverify", "--host", "tcp://h:2376"],
    ],
  ])("keeps the daemon options of %s", (command, options) => {
    const resource = compose(command);
    expect(resource?.docker).toEqual({ environment: {}, options });
    expect(resource?.down.startsWith(`docker ${options.join(" ")} compose -p app `)).toBe(true);
  });

  it("keeps a DOCKER_CONTEXT assignment and an exported DOCKER_HOST", () => {
    expect(compose("DOCKER_CONTEXT=dev docker compose -p app up -d")?.down).toMatch(
      /^DOCKER_CONTEXT=dev docker compose -p app /,
    );
    expect(compose("export DOCKER_HOST=ssh://u@h && docker compose -p app up -d")?.docker).toEqual({
      environment: { DOCKER_HOST: "ssh://u@h" },
      options: [],
    });
  });

  it("records nothing when env -u removes a daemon variable", () => {
    const command =
      "export DOCKER_HOST=ssh://u@h && env -u DOCKER_HOST docker compose -p app up -d";
    expect(detect(command).resources).toEqual([]);
  });

  it.each([
    'name=DOCKER_HOST; export DOCKER_HOST=ssh://u@h; env -u "$name" docker compose -p app up -d',
    'name=DOCKER_HOST; export DOCKER_HOST=ssh://u@h; env --unset "$name" docker compose -p app up -d',
  ])("records nothing for %s, whose unset variable is not literal", (command) => {
    expect(detect(command).resources).toEqual([]);
  });

  it.each([
    "sudo docker compose -p app up -d",
    "export DOCKER_HOST=ssh://u@h && sudo docker compose -p app up -d",
    "DOCKER_HOST=ssh://u@h sudo DOCKER_CONTEXT=dev docker compose -p app up -d",
  ])("records nothing for %s, whose daemon the sudoers policy selects", (command) => {
    expect(detect(command).resources).toEqual([]);
  });

  const GENERIC_COMPOSE_NOTES = detect('docker --context "$CTX" compose -p app up -d').notes;

  it.each([
    'name=DOCKER_HOST; export DOCKER_HOST=ssh://dev; unset "$name"',
    "export DOCKER_HOST=ssh://dev; export -n DOCKER_HOST",
    'v=DOCKER_HOST; export "$v=ssh://dev"',
    "DOCKER_HOST=ssh://dev; export DOCKER_HOST",
    "export DOCKER_HOST=ssh://dev; unset -f DOCKER_HOST",
    "declare -x DOCKER_HOST=ssh://dev",
    "source env.sh",
    ". env.sh",
    'eval "$cmd"',
    "source env.sh; export DOCKER_HOST=ssh://dev",
  ])("records no stack and gives the generic note after %s", (before) => {
    const result = detect(`${before}; docker compose -p app up -d`);
    expect(result.resources).toEqual([]);
    expect(result.notes).toEqual(GENERIC_COMPOSE_NOTES);
  });

  it.each([
    "export DOCKER_HOST=ssh://dev; unset -v DOCKER_HOST",
    "export DOCKER_HOST=ssh://dev; unset DOCKER_HOST",
    'export PATH="/x:$PATH"',
    'local dir="$1"',
  ])("records the stack on the local daemon after %s", (before) => {
    expect(compose(`${before}; docker compose -p app up -d`)?.docker).toEqual(DEFAULT_DAEMON);
  });

  it("repeats the daemon options in the cleanup of a detached container", () => {
    expect(container("docker -H ssh://u@h run -d img")?.down).toBe(
      `docker --host ssh://u@h stop ${SHORT_ID} && docker --host ssh://u@h rm ${SHORT_ID}`,
    );
    expect(container("DOCKER_HOST=ssh://u@h docker run -d --rm img")).toEqual({
      kind: "container",
      id: SHORT_ID,
      down: `DOCKER_HOST=ssh://u@h docker stop ${SHORT_ID}`,
      docker: { environment: { DOCKER_HOST: "ssh://u@h" }, options: [] },
    });
  });

  it("records the same project on two daemons as two resources", () => {
    const result = detect("docker compose up -d; docker --context dev compose up -d");
    expect(result.resources).toHaveLength(2);
  });

  it("gives a generic note when the daemon is not literal", () => {
    const result = detect('docker --context "$CTX" compose up -d');
    expect(result.resources).toEqual([]);
    expect(result.notes).toHaveLength(1);
  });
});

describe("subshell scopes", () => {
  it("keeps a cd inside parentheses in the subshell", () => {
    expect(worktrees("(cd /a); git worktree add wt")).toEqual([resolve("/w", "wt")]);
  });

  it("applies a cd inside parentheses to later commands of the same subshell", () => {
    expect(worktrees("(cd /a && git worktree add wt)")).toEqual([resolve("/a", "wt")]);
  });

  it("keeps a cd inside a command substitution in the substitution", () => {
    expect(worktrees("x=$(cd /a; pwd); git worktree add wt")).toEqual([resolve("/w", "wt")]);
    expect(worktrees("x=`cd /a`; git worktree add wt")).toEqual([resolve("/w", "wt")]);
  });

  it("shares the outer scope with a brace group", () => {
    expect(worktrees("{ cd /a; }; git worktree add wt")).toEqual([resolve("/a", "wt")]);
  });

  it("starts a subshell from the directory of its parent", () => {
    expect(worktrees("cd /a; (cd b; (git worktree add wt)); git worktree add top")).toEqual([
      resolve("/a", "b", "wt"),
      resolve("/a", "top"),
    ]);
  });

  it("keeps an unknown Docker environment inside a subshell", () => {
    expect(detect('(unset "$n"); docker compose -p app up -d').resources).toEqual([
      expect.objectContaining({ kind: "compose", docker: DEFAULT_DAEMON }),
    ]);
  });

  it("applies an unknown Docker environment to later commands of the same subshell", () => {
    expect(detect('(unset "$n"; docker compose -p app up -d)').resources).toEqual([]);
  });
});

describe("reminders", () => {
  const resources: Array<HygieneResource> = [
    { kind: "worktree", path: "/w/feat" },
    {
      kind: "compose",
      workingDir: "/w/feat",
      down: "docker compose --project-directory /w/feat down",
      docker: DEFAULT_DAEMON,
    },
    {
      kind: "container",
      id: "0123456789ab",
      down: "docker stop 0123456789ab",
      docker: DEFAULT_DAEMON,
    },
    { kind: "scratch", path: "/h/.cache/docks-kit/scratch/a b" },
    { kind: "tempDir", path: "/tmp/tmp.X" },
    { kind: "tempFile", path: "/tmp/tmp.Y" },
  ];
  const other: HygieneResource = {
    kind: "other",
    category: "background process",
    command: "npm run dev",
    hint: "Stop it before your final answer, or start it as a named bash service.",
  };

  it("quotes a path with a space", () => {
    expect(cleanupCommand(resources[3] as HygieneResource)).toBe(
      "docks-kit scratch remove '/h/.cache/docks-kit/scratch/a b'",
    );
  });

  it("names the cleanup command in a creation reminder", () => {
    expect(creationReminder(resources[0] as HygieneResource)).toBe(
      "You created the worktree /w/feat. When the task no longer needs it, run `git worktree remove -- /w/feat`.",
    );
    expect(creationReminder(other)).toBe(
      "This command created a background process (`npm run dev`). Stop it before your final answer, or start it as a named bash service.",
    );
  });

  it("names a temporary file and its cleanup command in a creation reminder", () => {
    const reminder = creationReminder({ kind: "tempFile", path: "/tmp/tmp.Y" });
    expect(reminder).toContain("the temporary file /tmp/tmp.Y");
    expect(reminder).toContain("`docks-kit scratch remove /tmp/tmp.Y`");
  });

  it("lists every cleanup command and the keep sentence at stop", () => {
    const text = stopReminder(resources, [other]);
    for (const resource of resources) expect(text).toContain(cleanupCommand(resource));
    expect(text).toContain("These resources from this session still exist:");
    expect(text).toContain(
      "These commands from this session may have left something running, installed, or created:",
    );
    expect(text).toContain("- background process: `npm run dev` (Stop it before");
    expect(text.split("\n").at(-1)).toBe(
      "Remove each resource that the task no longer needs. Keep a resource only when the user asked for it or a later step needs it, and name it with the reason in your final answer. Never stop or delete a production resource without an ask in the main session.",
    );
  });

  it("names the production rule at stop and for a remote resource", () => {
    expect(stopReminder([], [other])).toContain(
      "Never stop or delete a production resource without an ask in the main session.",
    );
    const [remote] = detectResources(
      "supabase branches create t",
      resolve("/w"),
      "",
      HOME,
    ).resources;
    expect(remote?.kind === "other" ? remote.hint : "").toContain(
      "For a production target, ask the user first.",
    );
  });
});

describe("sweep scheduling", () => {
  it("is due without a stamp and after 12 hours", () => {
    const now = Date.now();
    expect(sweepDue(undefined, now)).toBe(true);
    expect(sweepDue(now - 11 * HOUR_MS, now)).toBe(false);
    expect(sweepDue(now - 12 * HOUR_MS, now)).toBe(true);
  });

  /**
   * Each child imports the extension, prints `ready`, waits for one line on
   * stdin, calls claimSweep, and prints the result. The extension path comes
   * from argv, so the child imports it dynamically. The children run on Bun,
   * which loads the TypeScript module without a build step.
   */
  const CHILD_SOURCE = [
    'import { pathToFileURL } from "node:url";',
    "const [extension, cacheDir] = process.argv.slice(2);",
    "const { claimSweep } = await import(pathToFileURL(extension).href);",
    'process.stdin.once("data", () => {',
    "  const result = `${claimSweep(cacheDir, Date.now())}\\n`;",
    "  // Exit only after the pipe has the result; an early exit can drop it.",
    "  process.stdout.write(result, () => process.exit(0));",
    "});",
    'process.stdout.write("ready\\n");',
  ].join("\n");

  /** Starts `count` children together on one start barrier and returns their results. */
  async function raceClaims(cacheDir: string, count: number): Promise<Array<string>> {
    const script = join(sandbox(), "claim-child.mjs");
    writeFileSync(script, CHILD_SOURCE);
    const children = Array.from({ length: count }, () =>
      spawn(BUN_RUNTIME, [script, EXTENSION, cacheDir], { stdio: ["pipe", "pipe", "inherit"] }),
    );
    try {
      const outputs = children.map(() => "");
      // `close` comes after the stdout stream ends; `exit` can come before the last chunk.
      const closed = children.map((child) => {
        const { promise, resolve: done } = Promise.withResolvers<void>();
        child.on("close", () => done());
        return promise;
      });
      const ready = children.map((child, index) => {
        const { promise, resolve: done } = Promise.withResolvers<void>();
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          outputs[index] += chunk;
          if (outputs[index]?.includes("ready\n") === true) done();
        });
        return Promise.race([promise, closed[index]]);
      });
      await Promise.all(ready);
      for (const child of children) child.stdin.write("go\n");
      await Promise.all(closed);
      return outputs.map((output) => output.replace("ready\n", "").trim());
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }
    }
  }

  function makeStale(path: string, nowMs: number): void {
    writeFileSync(path, "1 stale-token");
    const twoMinutesAgo = (nowMs - 2 * 60 * 1000) / 1000;
    utimesSync(path, twoMinutesAgo, twoMinutesAgo);
  }

  it("lets exactly one of eight processes start the sweep", async () => {
    const cacheDir = join(sandbox(), "cache");
    const results = await raceClaims(cacheDir, 8);
    expect([...results].sort()).toEqual([
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(existsSync(join(cacheDir, "tidy.stamp"))).toBe(true);
    expect(existsSync(join(cacheDir, "tidy.stamp.claim"))).toBe(false);
  });

  it("lets exactly one of eight processes replace a stale claim", async () => {
    const cacheDir = sandbox();
    makeStale(join(cacheDir, "tidy.stamp.claim"), Date.now());
    const results = await raceClaims(cacheDir, 8);
    expect([...results].sort()).toEqual([
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(existsSync(join(cacheDir, "tidy.stamp"))).toBe(true);
  });

  it("replaces a stale claim and removes its own files", () => {
    const cacheDir = sandbox();
    const now = Date.now();
    makeStale(join(cacheDir, "tidy.stamp.claim"), now);

    expect(claimSweep(cacheDir, now)).toBe(true);
    expect(existsSync(join(cacheDir, "tidy.stamp.claim"))).toBe(false);
    expect(existsSync(join(cacheDir, "tidy.stamp.takeover"))).toBe(false);
  });

  it("does not replace a stale claim while another process holds the takeover mutex", () => {
    const cacheDir = sandbox();
    const now = Date.now();
    const claim = join(cacheDir, "tidy.stamp.claim");
    makeStale(claim, now);
    writeFileSync(join(cacheDir, "tidy.stamp.takeover"), "2 other-token");

    expect(claimSweep(cacheDir, now)).toBe(false);
    expect(readFileSync(claim, "utf8")).toBe("1 stale-token");
    expect(existsSync(join(cacheDir, "tidy.stamp"))).toBe(false);
  });

  it("replaces a stale takeover mutex one time", () => {
    const cacheDir = sandbox();
    const now = Date.now();
    makeStale(join(cacheDir, "tidy.stamp.claim"), now);
    makeStale(join(cacheDir, "tidy.stamp.takeover"), now);

    expect(claimSweep(cacheDir, now)).toBe(true);
    expect(existsSync(join(cacheDir, "tidy.stamp.takeover"))).toBe(false);
  });

  it("loses to a fresh claim and leaves it in place", () => {
    const cacheDir = sandbox();
    const claim = join(cacheDir, "tidy.stamp.claim");
    writeFileSync(claim, "");

    expect(claimSweep(cacheDir, Date.now())).toBe(false);
    expect(existsSync(claim)).toBe(true);
    expect(existsSync(join(cacheDir, "tidy.stamp"))).toBe(false);
  });
});

describe("subprocesses", () => {
  it("passes shell syntax to the child as one literal argument", async () => {
    const argument = "a;b $(x) | c";
    const result = await run(
      process.execPath,
      ["-e", "console.log(process.argv[process.argv.length - 1])", argument],
      { timeoutMs: 20_000 },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(argument);
  });

  it.skipIf(process.platform === "win32")("finds docks-kit only in an absolute PATH entry", () => {
    const bin = sandbox();
    const launcher = join(bin, "docks-kit");
    writeFileSync(launcher, "#!/bin/sh\n");
    chmodSync(launcher, 0o755);

    expect(resolveDocksKit({ PATH: `relative:${bin}` }, "linux")).toBe(launcher);
    expect(() => resolveDocksKit({ PATH: "relative" }, "linux")).toThrow(
      "docks-kit is not on PATH; install docks-kit and run docks-kit sync omp",
    );
  });
});

describe("extension handlers", () => {
  type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

  /** Loads the extension into a fake omp API that keeps the handlers and the tool names. */
  function load(): { handlers: Map<string, Handler>; tools: Array<string> } {
    const handlers = new Map<string, Handler>();
    const tools: Array<string> = [];
    const schema = { describe: () => schema };
    const api = {
      zod: { object: () => schema, string: () => schema, array: () => schema },
      on: (event: string, handler: Handler) => handlers.set(event, handler),
      registerTool: (definition: { name: string }) => tools.push(definition.name),
    } as unknown as ExtensionApi;
    docksKitOmp(api);
    return { handlers, tools };
  }

  async function bash(
    handlers: Map<string, Handler>,
    command: string,
    output = "",
  ): Promise<string | undefined> {
    const result = (await handlers.get("tool_result")?.(
      {
        toolName: "bash",
        input: { command },
        content: [{ type: "text", text: output }],
        isError: false,
      },
      { cwd: "/w" },
    )) as { additionalContext: string } | undefined;
    return result?.additionalContext;
  }

  it("registers the three tools and the three handlers", () => {
    const { handlers, tools } = load();
    expect(tools).toEqual(["scratch_new", "scratch_remove", "tidy_report"]);
    expect([...handlers.keys()]).toEqual(["tool_result", "session_stop", "session_start"]);
  });

  it.each([
    ["npm i -g x", "global install"],
    ["npm i --global x", "global install"],
    ["bun add x -g", "global install"],
    ["disown -h %1", "background process"],
    ["sleep 100 & disown", "background process"],
  ])("reminds after %s", async (command, category) => {
    const { handlers } = load();
    expect(await bash(handlers, command)).toContain(`This command created a ${category}`);
  });

  it.skipIf(process.platform === "win32")(
    "checks a Docker resource at stop on the daemon that created it",
    async () => {
      const bin = sandbox();
      const log = join(bin, "docker.log");
      const fakeDocker = join(bin, "docker");
      writeFileSync(
        fakeDocker,
        `#!/bin/sh\nprintf '%s|%s\\n' "$DOCKER_HOST" "$*" >> '${log}'\necho present\n`,
      );
      chmodSync(fakeDocker, 0o755);
      const savedPath = process.env["PATH"];
      const savedHost = process.env["DOCKER_HOST"];
      process.env["PATH"] = `${bin}:${savedPath ?? ""}`;
      delete process.env["DOCKER_HOST"];
      try {
        const { handlers } = load();
        await bash(handlers, "docker --context dev compose -p app up -d");
        await bash(handlers, "DOCKER_HOST=ssh://u@h docker run -d --rm img", `${CONTAINER_ID}\n`);
        const stop = (await handlers.get("session_stop")?.({ stop_hook_active: false }, {})) as {
          additionalContext: string;
        };

        expect(stop.additionalContext).toContain(
          "run `docker --context dev compose -p app --project-directory /w down`",
        );
        expect(stop.additionalContext).toContain(
          `run \`DOCKER_HOST=ssh://u@h docker stop ${SHORT_ID}\``,
        );
        expect(readFileSync(log, "utf8").trim().split("\n").sort()).toEqual(
          [
            "|--context dev ps -q --filter label=com.docker.compose.project.working_dir=/w",
            `ssh://u@h|ps -aq --filter id=${SHORT_ID}`,
          ].sort(),
        );
      } finally {
        process.env["PATH"] = savedPath;
        if (savedHost === undefined) delete process.env["DOCKER_HOST"];
        else process.env["DOCKER_HOST"] = savedHost;
      }
    },
  );

  it("reminds at creation and again at stop while the directory exists", async () => {
    const { handlers } = load();
    const directory = join(sandbox(), "scratch", "eval-ab12");
    mkdirSync(directory, { recursive: true });

    expect(await bash(handlers, "docks-kit scratch new eval", `${directory}\n`)).toBe(
      creationReminder({ kind: "scratch", path: directory }),
    );

    const stop = handlers.get("session_stop");
    const first = (await stop?.({ stop_hook_active: false }, { cwd: "/w" })) as {
      continue: boolean;
      additionalContext: string;
    };
    expect(first.continue).toBe(true);
    expect(first.additionalContext).toContain(`the scratch directory ${directory}`);
    expect(await stop?.({ stop_hook_active: true }, { cwd: "/w" })).toBeUndefined();
    expect(await stop?.({ stop_hook_active: false }, { cwd: "/w" })).toBeUndefined();
    expect(statSync(directory).isDirectory()).toBe(true);
  });

  it("reminds at stop while a mktemp file exists", async () => {
    const { handlers } = load();
    const file = join(sandbox(), "tmp.Y");
    writeFileSync(file, "");

    await bash(handlers, "mktemp", `${file}\n`);

    const stop = handlers.get("session_stop");
    const result = (await stop?.({ stop_hook_active: false }, { cwd: "/w" })) as
      | { additionalContext: string }
      | undefined;
    expect(result?.additionalContext).toContain(`the temporary file ${file}`);
  });

  it("ignores a failed bash call", async () => {
    const { handlers } = load();
    const result = await handlers.get("tool_result")?.(
      { toolName: "bash", input: { command: "git stash" }, content: [], isError: true },
      { cwd: "/w" },
    );
    expect(result).toBeUndefined();
  });
});

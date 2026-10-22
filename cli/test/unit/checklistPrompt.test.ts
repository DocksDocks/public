import { stripVTControlCharacters } from "node:util";
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path, Queue, Terminal } from "effect";
import { Prompt } from "effect/unstable/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChecklistItem, ChecklistOptions, ChecklistResult } from "../../src/checklistPrompt";

const ESC = "\u001b";
const BELL = "\u0007";
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`);
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_UP = `${ESC}[1A`;

const TITLE = "Items";
const MESSAGE = "Choose the items to keep.";
const NOTE = "Nothing is stored until you save.";
const ERROR = "Tick at least one item.";
const HINT = "↑↓ move · enter/space toggle · enter on Save saves · esc cancel";
const LABELS = ["alpha", "beta", "gamma"] as const;
type Label = (typeof LABELS)[number];

const LONG_DESCRIPTIONS: Record<Label, string> = {
  alpha:
    "First description that keeps going past the right edge of any normal terminal window, so the picker must cut it short and end it with a mark",
  beta: "Second description that also runs much longer than the panel can hold on one line, even when the terminal is one hundred columns wide",
  gamma:
    "Third description with enough words in it to overflow every width that these tests use, from forty columns up to one hundred columns",
};

// UAX #11 (https://www.unicode.org/reports/tr11/): code points with East Asian
// Width W or F use two terminal cells.
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];
// Marks (variation selectors included), controls, and format characters such
// as the zero-width joiner use no cell.
const ZERO_WIDTH = /^[\p{Mark}\p{Cc}\p{Cf}]$/u;
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;

function codePointCells(char: string): number {
  if (ZERO_WIDTH.test(char)) return 0;
  const code = char.codePointAt(0) ?? 0;
  const wide =
    EMOJI_PRESENTATION.test(char) || WIDE_RANGES.some(([low, high]) => code >= low && code <= high);
  return wide ? 2 : 1;
}

/** The terminal cells that `text` uses on one line. */
function cellWidth(text: string): number {
  let cells = 0;
  for (const char of text) cells += codePointCells(char);
  return cells;
}

const JAPANESE_DESCRIPTION =
  "日本語の説明テキストがとても長いのでこの行は端末の幅を超えますから最後は省略記号で終わる必要があります";
const HANGUL_DESCRIPTION =
  "이 설명은 아주 길어서 좁은 터미널에서도 넓은 터미널에서도 한 줄에 다 들어가지 않으므로 끝을 잘라서 줄임표로 마쳐야 합니다";

const WIDE_ITEMS: ReadonlyArray<ChecklistItem<Label>> = [
  { value: "alpha", label: "設定", description: JAPANESE_DESCRIPTION, checked: true },
  { value: "beta", label: "한국어", description: HANGUL_DESCRIPTION, checked: false },
  { value: "gamma", label: "gamma", description: "Third item", checked: true },
];

function items(
  checked: Record<Label, boolean>,
  descriptions: Record<Label, string> = {
    alpha: "First item",
    beta: "Second item",
    gamma: "Third item",
  },
): ReadonlyArray<ChecklistItem<Label>> {
  return LABELS.map((label) => ({
    value: label,
    label,
    description: descriptions[label],
    checked: checked[label],
  }));
}

function options(overrides: Partial<ChecklistOptions<Label>> = {}): ChecklistOptions<Label> {
  return {
    title: TITLE,
    message: MESSAGE,
    note: NOTE,
    items: items({ alpha: true, beta: false, gamma: true }),
    emptySelectionError: ERROR,
    ...overrides,
  };
}

const noneTicked = items({ alpha: false, beta: false, gamma: false });

function key(
  name: string,
  input?: string,
  modifiers: Partial<Omit<Terminal.Key, "name">> = {},
): Terminal.UserInput {
  return {
    input: Option.fromUndefinedOr(input),
    key: { name, ctrl: false, meta: false, shift: false, ...modifiers },
  };
}

const keys = {
  up: key("up", `${ESC}[A`),
  down: key("down", `${ESC}[B`),
  left: key("left", `${ESC}[D`),
  home: key("home", `${ESC}[H`),
  end: key("end", `${ESC}[F`),
  enter: key("return", "\r"),
  space: key("space", " "),
  escape: key("escape", ESC),
  tab: key("tab", "\t"),
  shiftTab: key("tab", `${ESC}[Z`, { shift: true }),
  j: key("j", "j"),
  k: key("k", "k"),
  q: key("q", "q"),
  x: key("x", "x"),
  ctrlC: key("c", "\u0003", { ctrl: true }),
  ctrlD: key("d", "\u0004", { ctrl: true }),
};

interface ChecklistRun {
  readonly exit: Exit.Exit<ChecklistResult<Label>, Terminal.QuitError>;
  readonly displays: ReadonlyArray<string>;
}

// Load the module after the platform and env stubs, so that a value read at
// import time also sees the stubs.
async function loadChecklist() {
  vi.resetModules();
  return import("../../src/checklistPrompt");
}

async function runChecklist(
  checklist: ChecklistOptions<Label>,
  input: ReadonlyArray<Terminal.UserInput>,
  columns = 100,
  columnsAfterFirstDisplay?: number,
): Promise<ChecklistRun> {
  const { checklistPrompt } = await loadChecklist();
  const displays: Array<string> = [];
  let currentColumns = columns;
  const terminal = Terminal.make({
    columns: Effect.sync(() => currentColumns),
    rows: Effect.succeed(40),
    readInput: Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>();
      yield* Queue.offerAll(queue, input);
      yield* Queue.end(queue);
      return queue;
    }),
    readLine: Effect.die("the checklist does not read lines"),
    display: (text) =>
      Effect.sync(() => {
        displays.push(text);
        // The terminal changes its width after the first frame is on screen.
        if (columnsAfterFirstDisplay !== undefined) currentColumns = columnsAfterFirstDisplay;
      }),
  });
  const exit = await Effect.runPromiseExit(
    Prompt.run(checklistPrompt(checklist)).pipe(
      Effect.provide(
        Layer.mergeAll(
          FileSystem.layerNoop({}),
          Path.layer,
          Layer.succeed(Terminal.Terminal, terminal),
        ),
      ),
    ),
  );
  return { exit, displays };
}

function resultOf(run: ChecklistRun): ChecklistResult<Label> {
  if (Exit.isFailure(run.exit)) {
    throw new Error(`the prompt failed: ${Cause.pretty(run.exit.cause)}`);
  }
  return run.exit.value;
}

function plain(text: string): string {
  return stripVTControlCharacters(text).replaceAll("\r", "");
}

/** The displayed frames with ANSI codes removed; one frame per handled key. */
function framesOf(run: ChecklistRun): Array<string> {
  return run.displays.map(plain).filter((frame) => frame.trim() !== "");
}

function frameAt(run: ChecklistRun, index: number): string {
  const frame = framesOf(run)[index];
  if (frame === undefined) throw new Error(`no frame at index ${index}`);
  return frame;
}

function labelPattern(label: Label): RegExp {
  return new RegExp(`\\b${label}\\b`);
}

function rowOf(frame: string, label: Label): string {
  const rows = frame.split("\n").filter((line) => labelPattern(label).test(line));
  expect(rows).toHaveLength(1);
  return rows[0] ?? "";
}

/** The item row with the pointer, or undefined when the pointer is on no item. */
function cursorAt(frame: string, pointer = "❯"): Label | undefined {
  const pointed = LABELS.filter((label) => rowOf(frame, label).includes(pointer));
  expect(pointed.length).toBeLessThanOrEqual(1);
  return pointed[0];
}

function expectLinesFit(run: ChecklistRun, columns: number): void {
  for (const display of run.displays) {
    for (const line of plain(display).split("\n")) {
      expect(cellWidth(line), `line ${JSON.stringify(line)}`).toBeLessThanOrEqual(columns - 1);
    }
  }
}

/** The cursor-up sequences in a display before the frame: the `clear` part for the old frame. */
function cursorUpsBeforeFrame(run: ChecklistRun, index: number): number {
  const display = run.displays[index];
  if (display === undefined) throw new Error(`no display at index ${index}`);
  const frameStart = display.indexOf(CURSOR_HIDE);
  expect(frameStart).toBeGreaterThanOrEqual(0);
  return display.slice(0, frameStart).split(CURSOR_UP).length - 1;
}

/** The lines of the frame in a display, with ANSI codes removed. */
function displayLines(run: ChecklistRun, index: number): Array<string> {
  const display = run.displays[index];
  if (display === undefined) throw new Error(`no display at index ${index}`);
  return plain(display).split("\n");
}

beforeEach(() => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  vi.stubEnv("NO_COLOR", undefined);
  vi.stubEnv("WT_SESSION", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("checklist prompt keys", () => {
  it("starts with the cursor on the first item", async () => {
    const run = await runChecklist(options(), [keys.escape]);

    expect(cursorAt(frameAt(run, 0))).toBe("alpha");
  });

  it("toggles the item under the cursor with Enter and saves with Enter on the Save row", async () => {
    const run = await runChecklist(options(), [
      keys.enter,
      keys.down,
      keys.enter,
      keys.end,
      keys.enter,
    ]);

    expect(rowOf(frameAt(run, 1), "alpha")).toContain("○");
    expect(frameAt(run, 1)).toContain("1 of 3 selected");
    expect(rowOf(frameAt(run, 3), "beta")).toContain("●");
    expect(frameAt(run, 3)).toContain("2 of 3 selected");
    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["beta", "gamma"] });
  });

  it("toggles the item under the cursor with Space and saves with Space on the Save row", async () => {
    const run = await runChecklist(options(), [
      keys.space,
      keys.space,
      keys.down,
      keys.down,
      keys.space,
      keys.end,
      keys.space,
    ]);

    expect(rowOf(frameAt(run, 1), "alpha")).toContain("○");
    expect(rowOf(frameAt(run, 2), "alpha")).toContain("●");
    expect(rowOf(frameAt(run, 5), "gamma")).toContain("○");
    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["alpha"] });
  });

  it("moves Down over the items and the Save row, then wraps to the first item", async () => {
    const run = await runChecklist(options(), [
      keys.down,
      keys.down,
      keys.down,
      keys.down,
      keys.enter,
      keys.end,
      keys.enter,
    ]);

    expect(cursorAt(frameAt(run, 1))).toBe("beta");
    expect(cursorAt(frameAt(run, 2))).toBe("gamma");
    expect(cursorAt(frameAt(run, 3))).toBeUndefined();
    expect(cursorAt(frameAt(run, 4))).toBe("alpha");
    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["gamma"] });
  });

  it("wraps Up from the first item to the Save row, where Enter saves", async () => {
    const run = await runChecklist(options(), [keys.up, keys.up, keys.down, keys.enter]);

    expect(cursorAt(frameAt(run, 1))).toBeUndefined();
    expect(cursorAt(frameAt(run, 2))).toBe("gamma");
    expect(cursorAt(frameAt(run, 3))).toBeUndefined();
    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["alpha", "gamma"] });
  });

  it("moves down with j and Tab and up with k and Shift+Tab", async () => {
    const run = await runChecklist(options(), [
      keys.j,
      keys.tab,
      keys.k,
      keys.shiftTab,
      keys.k,
      keys.j,
      keys.escape,
    ]);

    expect(cursorAt(frameAt(run, 1))).toBe("beta");
    expect(cursorAt(frameAt(run, 2))).toBe("gamma");
    expect(cursorAt(frameAt(run, 3))).toBe("beta");
    expect(cursorAt(frameAt(run, 4))).toBe("alpha");
    expect(cursorAt(frameAt(run, 5))).toBeUndefined();
    expect(cursorAt(frameAt(run, 6))).toBe("alpha");
  });

  it("jumps to the Save row with End and to the first item with Home", async () => {
    const run = await runChecklist(options(), [
      keys.end,
      keys.home,
      keys.down,
      keys.end,
      keys.enter,
    ]);

    expect(cursorAt(frameAt(run, 1))).toBeUndefined();
    expect(cursorAt(frameAt(run, 2))).toBe("alpha");
    expect(cursorAt(frameAt(run, 3))).toBe("beta");
    expect(cursorAt(frameAt(run, 4))).toBeUndefined();
    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["alpha", "gamma"] });
  });

  it("saves the ticked values in item order, not in tick order", async () => {
    const run = await runChecklist(options({ items: noneTicked }), [
      keys.up,
      keys.up,
      keys.enter,
      keys.home,
      keys.enter,
      keys.end,
      keys.enter,
    ]);

    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["alpha", "gamma"] });
  });

  it("shows the error on the Save row when nothing is ticked, and saves after the next toggle", async () => {
    const run = await runChecklist(options({ items: noneTicked }), [
      keys.end,
      keys.enter,
      keys.home,
      keys.space,
      keys.end,
      keys.enter,
    ]);

    expect(frameAt(run, 0)).toContain("0 of 3 selected");
    expect(frameAt(run, 0)).not.toContain(ERROR);

    const errorFrame = frameAt(run, 2).split("\n");
    const errorLine = errorFrame.findIndex((line) => line.includes(ERROR));
    const lastItemLine = errorFrame.findIndex((line) => labelPattern("gamma").test(line));
    expect(errorLine).toBeGreaterThan(lastItemLine);
    expect(errorFrame.join("\n")).not.toContain("0 of 3 selected");

    expect(frameAt(run, 4)).not.toContain(ERROR);
    expect(frameAt(run, 4)).toContain("1 of 3 selected");
    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["alpha"] });
  });

  it.each([
    ["Escape", keys.escape],
    ["Ctrl+C", keys.ctrlC],
    ["Ctrl+D", keys.ctrlD],
  ])("returns Cancelled on %s after a toggle", async (_name, cancel) => {
    const run = await runChecklist(options(), [keys.space, keys.down, cancel]);

    expect(Exit.isSuccess(run.exit)).toBe(true);
    expect(resultOf(run)).toEqual({ _tag: "Cancelled" });
  });

  it("ignores other keys without a change or a bell", async () => {
    const run = await runChecklist(options(), [
      keys.x,
      keys.q,
      keys.left,
      keys.enter,
      keys.end,
      keys.enter,
    ]);

    expect(resultOf(run)).toEqual({ _tag: "Saved", values: ["gamma"] });
    for (const display of run.displays) {
      expect(display).not.toContain(BELL);
    }
  });
});

describe("checklist prompt frame", () => {
  it("shows the title in the top border, the message, the note, the rows, the count, and the hint", async () => {
    const run = await runChecklist(options(), [keys.escape]);
    const frame = frameAt(run, 0);
    const lines = frame.split("\n");
    const content = lines.filter((line) => line.trim() !== "");

    expect(content[0]).toContain("╭");
    expect(content[0]).toContain(TITLE);
    expect(frame).toContain(MESSAGE);
    expect(frame).toContain(NOTE);
    expect(rowOf(frame, "alpha")).toMatch(/❯ ● alpha\s+First item/);
    expect(rowOf(frame, "beta")).toMatch(/○ beta\s+Second item/);
    expect(rowOf(frame, "gamma")).toMatch(/● gamma\s+Third item/);
    expect(frame).toContain("2 of 3 selected");

    const hintLine = lines.findIndex((line) => line.trim() === HINT);
    const bottomBorder = lines.findIndex((line) => line.includes("╰"));
    expect(bottomBorder).toBeGreaterThan(0);
    expect(hintLine).toBeGreaterThan(bottomBorder);
  });

  it("puts a blank line after the message when no note is given", async () => {
    const { note: _note, ...withoutNote } = options();
    const run = await runChecklist(withoutNote, [keys.escape]);
    const lines = frameAt(run, 0).split("\n");
    const messageLine = lines.findIndex((line) => line.includes(MESSAGE));

    expect(messageLine).toBeGreaterThan(0);
    expect(lines[messageLine + 1]?.replaceAll("│", "").trim()).toBe("");
    expect(frameAt(run, 0)).not.toContain(NOTE);
  });

  it.each([40, 60, 100])("fits every line within %i columns minus one", async (columns) => {
    const input = [keys.end, keys.enter, keys.home, keys.space, keys.down, keys.escape];
    const short = await runChecklist(options({ items: noneTicked }), input, columns);
    const long = await runChecklist(
      options({
        items: items({ alpha: false, beta: false, gamma: false }, LONG_DESCRIPTIONS),
      }),
      input,
      columns,
    );

    expect(resultOf(short)).toEqual({ _tag: "Cancelled" });
    expect(resultOf(long)).toEqual({ _tag: "Cancelled" });
    expectLinesFit(short, columns);
    expectLinesFit(long, columns);
  });

  it("ends a long description with an ellipsis and keeps the label whole", async () => {
    const run = await runChecklist(
      options({ items: items({ alpha: true, beta: false, gamma: true }, LONG_DESCRIPTIONS) }),
      [keys.escape],
      60,
    );
    const frame = frameAt(run, 0);

    for (const label of LABELS) {
      const row = rowOf(frame, label);
      expect(row).toContain("…");
      expect(row).not.toContain(LONG_DESCRIPTIONS[label]);
    }
    expectLinesFit(run, 60);
  });

  it.each([40, 60, 100])(
    "fits wide characters within %i columns minus one and keeps each label whole",
    async (columns) => {
      const run = await runChecklist(
        options({ items: WIDE_ITEMS }),
        [keys.down, keys.escape],
        columns,
      );
      const frame = frameAt(run, 0);
      const lines = frame.split("\n");

      expect(resultOf(run)).toEqual({ _tag: "Cancelled" });
      expectLinesFit(run, columns);
      for (const item of WIDE_ITEMS.slice(0, 2)) {
        const rows = lines.filter((line) => line.includes(item.label));
        expect(rows).toHaveLength(1);
        const row = rows[0] ?? "";
        expect(row).not.toContain(item.description);
        expect(row.replace(/│\s*$/, "").trimEnd()).toMatch(/…$/);
      }
    },
  );

  it("erases every line of the old frame after the terminal widens", async () => {
    const run = await runChecklist(options(), [keys.down, keys.escape], 60, 100);
    const firstLines = displayLines(run, 0).length;

    // The hint wraps to two lines at 60 columns and fits on one line at 100.
    expect(displayLines(run, 1).length).toBeLessThan(firstLines);
    expect(cursorUpsBeforeFrame(run, 1)).toBe(firstLines - 1);
  });

  it("erases every wrapped row of the old frame after the terminal narrows", async () => {
    const run = await runChecklist(
      options({ items: items({ alpha: true, beta: false, gamma: true }, LONG_DESCRIPTIONS) }),
      [keys.down, keys.escape],
      100,
      60,
    );
    const firstLines = displayLines(run, 0);
    const rows = firstLines.reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(cellWidth(line) / 60)),
      0,
    );

    // A line that is wider than 60 cells takes more rows after the terminal reflows.
    expect(Math.max(...firstLines.map(cellWidth))).toBeGreaterThan(60);
    expect(cursorUpsBeforeFrame(run, 1)).toBe(rows - 1);
  });

  it("drops the border below 40 columns and still fits every line", async () => {
    const run = await runChecklist(options(), [keys.down, keys.escape], 30);

    for (const frame of framesOf(run)) {
      expect(frame).not.toMatch(/[╭╮╰╯│]/);
    }
    expectLinesFit(run, 30);
  });

  it("renders 0 columns like 80 columns", async () => {
    const checklist = options({
      items: items({ alpha: true, beta: false, gamma: true }, LONG_DESCRIPTIONS),
    });
    const input = [keys.down, keys.space, keys.escape];
    const zero = await runChecklist(checklist, input, 0);
    const eighty = await runChecklist(checklist, input, 80);

    expect(framesOf(zero)).toEqual(framesOf(eighty));
    expectLinesFit(zero, 80);
  });

  it("writes no color codes when NO_COLOR is set", async () => {
    vi.stubEnv("NO_COLOR", "1");
    const run = await runChecklist(options({ items: noneTicked }), [
      keys.down,
      keys.end,
      keys.enter,
      keys.escape,
    ]);

    expect(run.displays.length).toBeGreaterThan(0);
    for (const display of run.displays) {
      expect(display).not.toMatch(SGR);
    }
  });

  it("writes color codes when NO_COLOR is set but empty", async () => {
    vi.stubEnv("NO_COLOR", "");
    const run = await runChecklist(options(), [keys.escape]);

    expect(run.displays.some((display) => SGR.test(display))).toBe(true);
  });

  it("uses the ASCII set on win32 without WT_SESSION", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const run = await runChecklist(options(), [keys.escape]);
    const frame = frameAt(run, 0);
    const lines = frame.split("\n");
    const content = lines.filter((line) => line.trim() !== "");

    for (const line of lines) {
      expect(line, `line ${JSON.stringify(line)}`).toMatch(/^[ -~]*$/);
    }
    expect(cursorAt(frame, ">")).toBe("alpha");
    expect(rowOf(frame, "alpha")).toContain("[x]");
    expect(rowOf(frame, "beta")).toContain("[ ]");
    expect(rowOf(frame, "gamma")).toContain("[x]");
    expect(content[0]?.trim()).toMatch(/^\+-.*Items.*-\+$/);
    expect(rowOf(frame, "alpha").trim()).toMatch(/^\|.*\|$/);
    expect(content.at(-1)).toContain("up/down move");
    expect(content.at(-1)).toContain("esc cancel");
    expectLinesFit(run, 100);
  });

  it("uses the Unicode set on win32 inside Windows Terminal", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("WT_SESSION", "0b7e4c55-5d43-4c1e-9f0a-1a2b3c4d5e6f");
    const run = await runChecklist(options(), [keys.escape]);
    const frame = frameAt(run, 0);

    expect(rowOf(frame, "alpha")).toMatch(/❯ ● alpha/);
    expect(rowOf(frame, "beta")).toContain("○");
    expect(frame.split("\n").some((line) => line.trim() === HINT)).toBe(true);
  });
});

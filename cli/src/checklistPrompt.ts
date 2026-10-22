import { Effect, Terminal } from "effect";
import { Prompt } from "effect/unstable/cli";

/** One row of a checklist. The label and the description are each one line of text. */
export interface ChecklistItem<A> {
  readonly value: A;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
}

export interface ChecklistOptions<A> {
  /** The text in the top border of the panel. */
  readonly title: string;
  readonly message: string;
  /** A dimmed text under the message. */
  readonly note?: string;
  readonly items: ReadonlyArray<ChecklistItem<A>>;
  /** The text on the Save row after a save with no ticked item. */
  readonly emptySelectionError: string;
}

/** `Saved` lists the ticked values in item order. */
export type ChecklistResult<A> =
  | { readonly _tag: "Saved"; readonly values: ReadonlyArray<A> }
  | { readonly _tag: "Cancelled" };

interface ChecklistState {
  /** An item index, or the item count for the Save row. */
  readonly cursor: number;
  readonly checked: ReadonlyArray<boolean>;
  /** A save with no ticked item sets it; the next toggle clears it. */
  readonly showError: boolean;
}

type ChecklistAction<A> = Prompt.Action<ChecklistState, ChecklistResult<A>>;

type Style = "plain" | "bold" | "dim" | "accent" | "accentBold" | "green" | "red";

interface Span {
  readonly text: string;
  readonly style: Style;
}

type Line = ReadonlyArray<Span>;

interface Glyphs {
  readonly pointer: string;
  readonly ticked: string;
  readonly unticked: string;
  readonly ellipsis: string;
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
  readonly hint: ReadonlyArray<string>;
  readonly hintSeparator: string;
}

const UNICODE: Glyphs = {
  pointer: "❯",
  ticked: "●",
  unticked: "○",
  ellipsis: "…",
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  hint: ["↑↓ move", "enter/space toggle", "enter on Save saves", "esc cancel"],
  hintSeparator: " · ",
};

// The legacy Windows console can show the Unicode glyphs as boxes.
const ASCII: Glyphs = {
  pointer: ">",
  ticked: "[x]",
  unticked: "[ ]",
  ellipsis: "...",
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  hint: ["up/down move", "enter/space toggle", "enter on Save saves", "esc cancel"],
  hintSeparator: " - ",
};

const SGR: Record<Style, string> = {
  plain: "",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  accent: "\u001b[36m",
  accentBold: "\u001b[1;36m",
  green: "\u001b[32m",
  red: "\u001b[31m",
};
const SGR_RESET = "\u001b[0m";
const CURSOR_HIDE = "\u001b[?25l";
const ERASE_LINE = "\u001b[2K";
const CURSOR_UP = "\u001b[1A";
const CURSOR_COLUMN_ONE = "\u001b[G";

/** A terminal that reports 0 columns does not know its width. */
const DEFAULT_COLUMNS = 80;
/** Below this width, the border takes too much of each line. */
const BORDER_MIN_COLUMNS = 40;
/** The columns of "│ " and " │" around the panel content. */
const BORDER_COLUMNS = 4;
/** The hint starts in the column of the panel content. */
const BORDERED_HINT_INDENT = 2;
const GAP = "  ";
const SAVE_LABEL = "Save";

const CANCELLED = { _tag: "Submit", value: { _tag: "Cancelled" } } as const;
const IGNORED = { _tag: "Beep" } as const;

/**
 * A checklist in a panel. Enter or Space toggles the item under the cursor and
 * saves on the Save row; Escape, Ctrl+C, and Ctrl+D cancel.
 */
export function checklistPrompt<A>(
  options: ChecklistOptions<A>,
): Prompt.Prompt<ChecklistResult<A>> {
  const initial: ChecklistState = {
    cursor: 0,
    checked: options.items.map((item) => item.checked),
    showError: false,
  };
  return Prompt.Custom<ChecklistState, ChecklistResult<A>>(initial, {
    render: (state, action) => {
      // Beep shows no bell and no change. Submit leaves the panel erased, so
      // the caller prints the result in its place.
      if (action._tag !== "NextFrame") return Effect.succeed("");
      // https://no-color.org: a NO_COLOR value that is set and not empty turns color off.
      const color = (process.env.NO_COLOR ?? "") === "";
      return Effect.map(frameOf(options, state), (frame) => {
        const lines = frame.map((line) => paint(line, color));
        return CURSOR_HIDE + lines.join("\n");
      });
    },
    process: (input, state) => Effect.succeed(nextAction(options.items, input.key, state)),
    clear: (state) =>
      Effect.map(frameOf(options, state), (frame) => {
        // The cursor stays on the last line of the frame: erase each line from
        // there up to the first line.
        const above = `${CURSOR_UP}${ERASE_LINE}`.repeat(frame.length - 1);
        return `${ERASE_LINE}${above}${CURSOR_COLUMN_ONE}`;
      }),
  });
}

function nextAction<A>(
  items: ReadonlyArray<ChecklistItem<A>>,
  key: Terminal.Key,
  state: ChecklistState,
): ChecklistAction<A> {
  const saveRow = items.length;
  const rows = saveRow + 1;
  // The cursor wraps over the items and the Save row.
  const moveBy = (step: number): ChecklistAction<A> => ({
    _tag: "NextFrame",
    state: { ...state, cursor: (state.cursor + step + rows) % rows },
  });
  switch (key.name) {
    case "up":
    case "k":
      return moveBy(-1);
    case "down":
    case "j":
      return moveBy(1);
    case "tab":
      return moveBy(key.shift ? -1 : 1);
    case "home":
      return { _tag: "NextFrame", state: { ...state, cursor: 0 } };
    case "end":
      return { _tag: "NextFrame", state: { ...state, cursor: saveRow } };
    case "return":
    case "enter":
    case "space": {
      if (state.cursor === saveRow) return save(items, state);
      const checked = state.checked.map((on, row) => (row === state.cursor ? !on : on));
      return { _tag: "NextFrame", state: { ...state, checked, showError: false } };
    }
    case "escape":
      return CANCELLED;
    // Ctrl+C and Ctrl+D also end the terminal input: they must give a result
    // here, or the prompt fails with a QuitError.
    case "c":
    case "d":
      return key.ctrl ? CANCELLED : IGNORED;
    default:
      return IGNORED;
  }
}

function save<A>(
  items: ReadonlyArray<ChecklistItem<A>>,
  state: ChecklistState,
): ChecklistAction<A> {
  const values = items.filter((_item, index) => state.checked[index]).map((item) => item.value);
  return values.length === 0
    ? { _tag: "NextFrame", state: { ...state, showError: true } }
    : { _tag: "Submit", value: { _tag: "Saved", values } };
}

// Read the host when the prompt renders, so that the values in effect at that
// time apply.
function frameOf<A>(options: ChecklistOptions<A>, state: ChecklistState) {
  return Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const columns = yield* terminal.columns;
    // Windows Terminal sets WT_SESSION and shows the Unicode glyphs.
    const glyphs =
      process.platform === "win32" && (process.env.WT_SESSION ?? "") === "" ? ASCII : UNICODE;
    return frameLines(options, state, columns, glyphs);
  });
}

function paint(line: Line, color: boolean): string {
  let text = "";
  for (const part of line) {
    const code = color ? SGR[part.style] : "";
    text += code === "" ? part.text : `${code}${part.text}${SGR_RESET}`;
  }
  return text;
}

interface Layout {
  /** The most columns that one line can use. */
  readonly width: number;
  readonly bordered: boolean;
  /** The columns of the panel content. */
  readonly inner: number;
  /** The columns of the marker, the label, and their padding, or of the Save label. */
  readonly nameWidth: number;
  /** The column where the descriptions and the Save status start. */
  readonly statusColumn: number;
}

function measure<A>(options: ChecklistOptions<A>, columns: number, glyphs: Glyphs): Layout {
  const known = columns > 0 ? columns : DEFAULT_COLUMNS;
  // A line that fills the last column can wrap, and then `clear` erases too
  // few lines.
  const width = known - 1;
  const bordered = known >= BORDER_MIN_COLUMNS;
  const total = options.items.length;
  const markerWidth = Math.max(widthOf(glyphs.ticked), widthOf(glyphs.unticked));
  const labelWidth = Math.max(0, ...options.items.map((item) => widthOf(item.label)));
  const nameWidth = Math.max(markerWidth + 1 + labelWidth, widthOf(SAVE_LABEL));
  const statusColumn = widthOf(glyphs.pointer) + 1 + nameWidth + GAP.length;
  // Size the panel for its widest content in all states, so that its width
  // stays the same when the error shows. The top border needs two columns
  // more than the title.
  const natural = Math.max(
    widthOf(options.title) + 2,
    widthOf(options.message),
    widthOf(options.note ?? ""),
    ...options.items.map((item) => statusColumn + widthOf(item.description)),
    statusColumn + widthOf(`${total} of ${total} selected`),
    statusColumn + widthOf(options.emptySelectionError),
  );
  return {
    width,
    bordered,
    inner: bordered ? Math.min(natural, width - BORDER_COLUMNS) : width,
    nameWidth,
    statusColumn,
  };
}

function frameLines<A>(
  options: ChecklistOptions<A>,
  state: ChecklistState,
  columns: number,
  glyphs: Glyphs,
): Array<Line> {
  const layout = measure(options, columns, glyphs);
  const note: Array<string> =
    options.note === undefined ? [] : pack(words(options.note), " ", layout.inner);
  const body: Array<Line> = [
    ...pack(words(options.message), " ", layout.inner).map((text) => [span(text)]),
    ...note.map((text) => [span(text, "dim")]),
    [],
    ...options.items.map((item, index) =>
      itemRow(item, state.checked[index], state.cursor === index, layout, glyphs),
    ),
    [],
    ...saveRows(options, state, layout, glyphs),
  ];
  const hintIndent = layout.bordered ? BORDERED_HINT_INDENT : 0;
  const hint = pack(glyphs.hint, glyphs.hintSeparator, layout.width - hintIndent).map((text) =>
    fit([span(" ".repeat(hintIndent)), span(text, "dim")], layout.width, glyphs.ellipsis),
  );
  if (!layout.bordered) {
    return [
      fit([span(options.title, "bold")], layout.width, glyphs.ellipsis),
      ...body.map((line) => fit(line, layout.width, glyphs.ellipsis)),
      [],
      ...hint,
    ];
  }
  return [
    topBorder(options.title, layout.inner, glyphs),
    ...body.map((line) => boxed(line, layout.inner, glyphs)),
    [
      span(
        `${glyphs.bottomLeft}${glyphs.horizontal.repeat(layout.inner + 2)}${glyphs.bottomRight}`,
        "dim",
      ),
    ],
    ...hint,
  ];
}

function itemRow<A>(
  item: ChecklistItem<A>,
  ticked: boolean,
  current: boolean,
  layout: Layout,
  glyphs: Glyphs,
): Line {
  const marker = ticked ? span(glyphs.ticked, "green") : span(glyphs.unticked, "dim");
  const padding = layout.nameWidth - widthOf(marker.text) - 1 - widthOf(item.label);
  return [
    current ? span(glyphs.pointer, "accent") : span(" ".repeat(widthOf(glyphs.pointer))),
    span(" "),
    marker,
    span(" "),
    span(item.label, current ? "bold" : "plain"),
    span(" ".repeat(padding) + GAP),
    span(item.description, "dim"),
  ];
}

function saveRows<A>(
  options: ChecklistOptions<A>,
  state: ChecklistState,
  layout: Layout,
  glyphs: Glyphs,
): Array<Line> {
  const current = state.cursor === options.items.length;
  const count = state.checked.filter((ticked) => ticked).length;
  const status = state.showError
    ? span(options.emptySelectionError, "red")
    : span(`${count} of ${options.items.length} selected`, "dim");
  // Wrap the status below its start column, so that a long error stays readable.
  const [first = "", ...rest] = pack(words(status.text), " ", layout.inner - layout.statusColumn);
  return [
    [
      current ? span(glyphs.pointer, "accent") : span(" ".repeat(widthOf(glyphs.pointer))),
      span(" "),
      span(SAVE_LABEL, current ? "accentBold" : "plain"),
      span(" ".repeat(layout.nameWidth - widthOf(SAVE_LABEL)) + GAP),
      span(first, status.style),
    ],
    ...rest.map((text) => [span(" ".repeat(layout.statusColumn)), span(text, status.style)]),
  ];
}

function topBorder(title: string, inner: number, glyphs: Glyphs): Line {
  // Keep at least one horizontal glyph between the title and the corner.
  const shown = fit([span(title, "bold")], inner - 2, glyphs.ellipsis);
  const fill = inner - 1 - lineWidth(shown);
  return [
    span(`${glyphs.topLeft}${glyphs.horizontal} `, "dim"),
    ...shown,
    span(` ${glyphs.horizontal.repeat(fill)}${glyphs.topRight}`, "dim"),
  ];
}

function boxed(line: Line, inner: number, glyphs: Glyphs): Line {
  const content = fit(line, inner, glyphs.ellipsis);
  return [
    span(`${glyphs.vertical} `, "dim"),
    ...content,
    span(" ".repeat(inner - lineWidth(content))),
    span(` ${glyphs.vertical}`, "dim"),
  ];
}

function span(text: string, style: Style = "plain"): Span {
  return { text, style };
}

// Count code points: each glyph of the frame uses one column.
function widthOf(text: string): number {
  return [...text].length;
}

function lineWidth(line: Line): number {
  return line.reduce((sum, part) => sum + widthOf(part.text), 0);
}

/** Cuts `line` to `width` columns and ends a cut line with the ellipsis. */
function fit(line: Line, width: number, ellipsis: string): Line {
  if (lineWidth(line) <= width) return line;
  const room = width - widthOf(ellipsis);
  if (room < 0) return [span([...ellipsis].slice(0, Math.max(width, 0)).join(""))];
  const kept: Array<Span> = [];
  let used = 0;
  for (const part of line) {
    const chars = [...part.text];
    if (used + chars.length > room) {
      const cut = chars.slice(0, room - used).join("");
      kept.push(span(cut.trimEnd() + ellipsis, part.style));
      break;
    }
    kept.push(part);
    used += chars.length;
  }
  return kept;
}

function words(text: string): Array<string> {
  return text.split(/\s+/).filter((word) => word !== "");
}

/**
 * Joins `parts` with `separator` into lines of at most `width` columns. A part
 * never breaks; `fit` cuts a part that is wider than `width`.
 */
function pack(parts: ReadonlyArray<string>, separator: string, width: number): Array<string> {
  const lines: Array<string> = [];
  let current = "";
  for (const part of parts) {
    const joined = current === "" ? part : `${current}${separator}${part}`;
    if (current !== "" && widthOf(joined) > width) {
      lines.push(current);
      current = part;
    } else {
      current = joined;
    }
  }
  lines.push(current);
  return lines;
}

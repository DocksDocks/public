import { describe, expect, it } from "vitest";
import { terminalCells, terminalRows } from "../../src/terminalCells";

describe("terminalCells", () => {
  it.each([
    ["\u2329", "left-pointing angle bracket (W)"],
    ["\u232A", "right-pointing angle bracket (W)"],
    ["\u3000", "ideographic space (F)"],
    ["\uFF21", "fullwidth A (F)"],
    ["\u6F22", "CJK ideograph 漢 (W)"],
    ["\uAC00", "Hangul syllable 가 (W)"],
    ["\u{1F600}", "emoji 😀 (W)"],
    ["\u2705", "emoji ✅ (W)"],
  ])("gives 2 cells for %j, the %s", (text) => {
    expect(terminalCells(text)).toBe(2);
  });

  it.each([
    ["a", "ASCII letter"],
    ["\uFF71", "halfwidth katakana (H)"],
    ["\u25CF", "black circle ●"],
    ["\u256D", "box corner ╭"],
    ["\u276F", "heavy angle quotation mark ❯"],
    ["\u00E9", "precomposed é"],
  ])("gives 1 cell for %j, the %s", (text) => {
    expect(terminalCells(text)).toBe(1);
  });

  it("gives 1 cell for a letter and a combining mark", () => {
    expect(terminalCells("e\u0301")).toBe(1);
  });

  it("gives 0 cells for the zero-width joiner", () => {
    expect(terminalCells("\u200D")).toBe(0);
  });

  it("gives 0 cells for a variation selector alone", () => {
    expect(terminalCells("\uFE0F")).toBe(0);
  });

  it("adds the cells of each character", () => {
    expect(terminalCells("漢字")).toBe(4);
  });

  it("gives 0 cells for an empty text", () => {
    expect(terminalCells("")).toBe(0);
  });
});

describe("terminalRows", () => {
  it("puts one wide character on each row when two do not fit in 3 columns", () => {
    expect(terminalRows("漢".repeat(6), 3)).toBe(6);
  });

  it("puts 3 narrow characters on each row at 3 columns", () => {
    expect(terminalRows("aaaaaa", 3)).toBe(2);
  });

  it("uses 1 row when the text fills the row exactly", () => {
    expect(terminalRows("abc", 3)).toBe(1);
  });

  it("starts a new row for the character after a full row", () => {
    expect(terminalRows("abcd", 3)).toBe(2);
  });

  it("moves a wide character to the next row when it does not fit after a narrow one", () => {
    expect(terminalRows("a漢", 2)).toBe(2);
  });

  it("uses 1 row for an empty text", () => {
    expect(terminalRows("", 80)).toBe(1);
  });

  it("puts one character on each row at 1 column", () => {
    expect(terminalRows("a".repeat(12), 1)).toBe(12);
    expect(terminalRows("漢".repeat(6), 1)).toBe(6);
  });

  it.each([0, -5])("counts %i columns as 1 column", (columns) => {
    expect(terminalRows("abc", columns)).toBe(3);
    expect(terminalRows("漢".repeat(6), columns)).toBe(6);
  });
});

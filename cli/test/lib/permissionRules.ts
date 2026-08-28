/**
 * Permission-rule oracle for the kit's Claude settings, ported from the rule
 * parser and matcher inside the Claude Code 2.1.251 binary rather than guessed:
 *
 * - Validation counts backslash parity, so a `)` preceded by an odd number of
 *   backslashes is escaped and does not close the rule. `claude doctor` over a
 *   throwaway config directory confirms it: `PowerShell(rm *-Recurse* \)` is
 *   rejected with `Mismatched parentheses`, and `PowerShell(rm *-Recurse* \\)`
 *   is accepted.
 * - Matching recognises only two escapes, `\*` for a literal asterisk and `\\`
 *   for a literal backslash. Every other backslash stays literal, so
 *   `Remove-Item \ *-Recurse*` matches a command that deletes the drive root
 *   `\`, and `*` matches any text.
 *
 * The oracle lets the settings tests assert "Claude Code can load every rule the
 * kit ships, and the deny list stops these commands" instead of restating the
 * rule text, which is what made the previous assertions change detectors.
 *
 * Rules and commands are both written `Tool(text)`; the command text is raw, so
 * a Windows root is a single backslash there and a doubled one in a rule.
 */

/** Tools that execute a shell command, whatever the specifier says. */
export const SHELL_TOOLS = ["Bash", "PowerShell"] as const

/** Tools that read without changing state; Claude Code auto-approves these. */
export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "NotebookRead"] as const

export interface ParsedRule {
  readonly tool: string
  /** Absent for a bare `Tool` rule, which covers every use of that tool. */
  readonly specifier: string | undefined
}

export type ParseResult =
  | { readonly ok: true; readonly rule: ParsedRule }
  | { readonly ok: false; readonly reason: string }

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/
const STAR = "\u0000ESCAPED_STAR\u0000"
const BACKSLASH = "\u0000ESCAPED_BACKSLASH\u0000"

/** Is the character at `index` escaped by an odd run of backslashes? */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++
  return backslashes % 2 !== 0
}

export function parseRule(text: string): ParseResult {
  if (text === "") return { ok: false, reason: "empty rule" }
  const open = text.indexOf("(")
  if (open === -1) {
    if (!TOOL_NAME.test(text)) return { ok: false, reason: `not a tool name: ${text}` }
    return { ok: true, rule: { tool: text, specifier: undefined } }
  }

  const tool = text.slice(0, open)
  if (!TOOL_NAME.test(tool)) return { ok: false, reason: `not a tool name: ${tool}` }

  let depth = 1
  let closedAt = -1
  for (let i = open + 1; i < text.length && closedAt === -1; i++) {
    if (isEscaped(text, i)) continue
    if (text[i] === "(") depth++
    else if (text[i] === ")") {
      depth--
      if (depth === 0) closedAt = i
    }
  }
  if (closedAt === -1) return { ok: false, reason: "mismatched parentheses" }
  if (closedAt !== text.length - 1) return { ok: false, reason: "trailing text after the specifier" }
  return { ok: true, rule: { tool, specifier: text.slice(open + 1, closedAt) } }
}

/** Every rule in `rules` the parser rejects, paired with its reason. */
export function invalidRules(rules: ReadonlyArray<string>): Array<{ rule: string; reason: string }> {
  return rules.flatMap((rule) => {
    const parsed = parseRule(rule)
    return parsed.ok ? [] : [{ rule, reason: parsed.reason }]
  })
}

/**
 * Does `rule` govern `command` run through `tool`? The command is raw text, so
 * a Windows drive root is one backslash here and two inside a rule.
 */
export function ruleMatchesCommand(rule: string, tool: string, command: string): boolean {
  const parsedRule = parseRule(rule)
  if (!parsedRule.ok) return false
  if (parsedRule.rule.tool !== tool) return false
  if (parsedRule.rule.specifier === undefined) return true

  let held = ""
  const specifier = parsedRule.rule.specifier.trim()
  for (let i = 0; i < specifier.length; i++) {
    const next = specifier[i + 1]
    if (specifier[i] === "\\" && (next === "*" || next === "\\")) {
      held += next === "*" ? STAR : BACKSLASH
      i++
      continue
    }
    held += specifier[i]
  }

  const pattern = held
    .replace(/[.+?^${}()|[\]\\'"]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll(STAR, "\\*")
    .replaceAll(BACKSLASH, "\\\\")
  return new RegExp(`^${pattern}$`, "s").test(command.trim())
}

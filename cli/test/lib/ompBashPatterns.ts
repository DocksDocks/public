/**
 * Approval oracle for the kit's omp `bash.patterns`, ported from
 * `@oh-my-pi/pi-coding-agent` 18.11.1 rather than guessed: `src/tools/bash.ts`
 * (`bashApprovalPatternToRegExp`, `bashApprovalRuleMatches`,
 * `findBashApprovalPatternRule`, `hasBashApprovalShellControl`,
 * `CRITICAL_BASH_PATTERNS`, `BashTool.approval`) and `src/tools/shell-tokenize.ts`
 * (`tokenizeShellSegments`), plus the resolver that `omp://approval-mode.md`
 * documents.
 *
 * - Whitespace runs in the rule and the command collapse to one space.
 * - `*` matches any text, spaces included. No escape spells a literal `*`.
 *   The match is anchored and case-sensitive.
 * - The rules are ordered, and the first matching rule wins.
 * - A deny or prompt rule matches the whole command or any one segment. A
 *   segment is the words between `;`, `&`, `|`, `(`, `)`, or a newline, with
 *   quotes and escapes removed, joined by one space.
 * - An allow rule matches only the whole command, and never a command that
 *   holds shell control such as `;`, `|`, `$`, or a redirection.
 * - A deny rule wins. Next, a command that matches a critical pattern gets a
 *   bare safety override, which replaces a matching allow or prompt rule. In
 *   `yolo` mode, omp ignores a bare override, so the command runs.
 *
 * The port covers the default `bash.allowCompoundCommands: false` path.
 */

export type OmpApproval = "allow" | "prompt" | "deny";

export interface OmpBashRule {
  readonly match: string;
  readonly approval: OmpApproval;
}

const SHELL_CONTROL = /[\n\r;&|<>`$()]/u;
const REINTERPRETED_ARGUMENT = /(?:^|[ \t])(?:-[^-]*[ce]|--(?:command|eval))(?:[= \t]|$)/u;

function patternRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/\s+/gu, " ")
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "u");
}

/** `tokenizeShellSegments`: quote-stripped words per segment, joined by one space. */
function commandSegments(command: string): Array<string> {
  const segments: Array<string> = [];
  let words: Array<string> = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      const next = command[i + 1];
      if (ch === "\\" && next !== undefined && '"\\$`'.includes(next)) {
        word += next;
        i++;
      } else if (ch === '"') quote = undefined;
      else word += ch;
      continue;
    }
    if (" \t\n;&|()".includes(ch)) {
      if (word.length > 0) words.push(word);
      word = "";
      if (ch !== " " && ch !== "\t" && words.length > 0) {
        segments.push(words.join(" "));
        words = [];
      }
      continue;
    }
    const next = command[i + 1];
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "\\" && next !== undefined) {
      word += next;
      i++;
    } else word += ch;
  }
  if (word.length > 0) words.push(word);
  if (words.length > 0) segments.push(words.join(" "));
  return segments;
}

/** `hasBashApprovalShellControl`: does the command hold shell syntax an allow rule must not vouch for? */
function hasShellControl(command: string): boolean {
  let quote: "'" | '"' | undefined;
  let reinterpretable = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else if (SHELL_CONTROL.test(ch)) reinterpretable = true;
      continue;
    }
    if (ch === "\\") {
      const escaped = command[i + 1];
      if (escaped !== undefined && SHELL_CONTROL.test(escaped)) reinterpretable = true;
      i++;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === "`" || ch === "$") return true;
      else if (SHELL_CONTROL.test(ch)) reinterpretable = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (SHELL_CONTROL.test(ch)) return true;
  }
  return reinterpretable && REINTERPRETED_ARGUMENT.test(command);
}

/**
 * The approval of the first rule that matches `command`, or undefined when no
 * rule matches and the approval mode decides (the kit ships `yolo`).
 */
export function ompApproval(
  rules: ReadonlyArray<OmpBashRule>,
  command: string,
): OmpApproval | undefined {
  const whole = command.trim().replace(/\s+/gu, " ");
  if (whole.length === 0) return undefined;
  const segments = commandSegments(command);
  const rule = rules.find(({ match, approval }) => {
    const regex = patternRegExp(match);
    if (approval === "allow") return !hasShellControl(command) && regex.test(whole);
    return regex.test(whole) || segments.some((segment) => regex.test(segment));
  });
  return rule?.approval;
}

/** `CRITICAL_BASH_PATTERNS` in omp 18.11.1 `src/tools/bash.ts`, verbatim. */
const CRITICAL_BASH_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+(?:-\S+\s+)*(?:-[a-z]*[rRfF][a-z]*|--recursive|--force)\s+(?:-\S+\s+)*\//i,
  /\brm\s+(?:-\S+\s+)*--no-preserve-root\b/i,
  /\bsudo\s+rm\b/i,
  /\bchmod\s+-R\s+[0-7]+\s+\//i,
  /\bchmod\s+-R\s+[ugoa+\-=rwxXst,]+\s+\//,
  /\bchown\s+-R\s+\S+\s+\//i,
  /:\(\)\s*\{\s*:\s*\|\s*:/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bmkfs(\.|\b)/i,
  /\bdd\s+if=.+of=\/dev\//i,
  /\bshred\s+\/dev\//i,
  /\bcryptsetup\b/i,
  />\s*\/etc\/(?:passwd|shadow|sudoers)\b/i,
  /\btee\s+(?:-a\s+)?\/etc\/(?:passwd|shadow|sudoers)\b/i,
  /\b(?:curl|wget|fetch)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i,
  /(?:^|[\s;&|(])(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget|fetch)\b/i,
  /\beval\s+["'`]?\$\(\s*(?:curl|wget|fetch)\b|\beval\s+`\s*(?:curl|wget|fetch)\b/i,
  /\bkill\s+-9\s+1\b/,
  /(?:^|[\s;&|(])(?:shutdown|poweroff|reboot|halt)(?:\s|$|[;|&])/i,
  /(?:^|[\s;&|(])init\s+0\b/i,
  /\bnc\b[^|;]*\s-[a-zA-Z]*[ec][a-zA-Z]*\s/i,
];

/** Does omp's critical-command check flag `command`? */
export function isOmpCritical(command: string): boolean {
  return command !== "" && CRITICAL_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * What omp does with `command` under the kit's `tools.approvalMode: yolo` and no
 * `tools.approval.bash` policy: `BashTool.approval`, then the generic resolver.
 * `prompt` asks a person in the main session; a headless subagent rejects it.
 */
export function ompYoloOutcome(rules: ReadonlyArray<OmpBashRule>, command: string): OmpApproval {
  const approval = ompApproval(rules, command);
  if (approval === "deny") return "deny";
  // A bare override carries no policy, and yolo ignores it.
  if (isOmpCritical(command)) return "allow";
  return approval ?? "allow";
}

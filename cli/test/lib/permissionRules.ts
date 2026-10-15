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
 * - A trailing ` *` that is the only wildcard also matches the bare command,
 *   as https://code.claude.com/docs/en/permissions documents.
 * - PowerShell rules match case-insensitively, as the same page documents.
 * - `permissionDecision` applies the documented precedence: deny, then ask,
 *   then allow, and matches Bash deny and ask rules past leading variable
 *   assignments. It matches one simple command; it does not split compound
 *   commands or strip wrappers such as `timeout` or `nice`.
 *
 * The oracle lets the settings tests assert "Claude Code can load every rule the
 * kit ships, and the deny list stops these commands" instead of restating the
 * rule text, which is what made the previous assertions change detectors.
 *
 * Rules and commands are both written `Tool(text)`; the command text is raw, so
 * a Windows root is a single backslash there and a doubled one in a rule.
 */

/** Tools that execute a shell command, whatever the specifier says. */
export const SHELL_TOOLS = ["Bash", "PowerShell"] as const;

/** Tools that read without changing state; Claude Code auto-approves these. */
export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "NotebookRead"] as const;

export interface ParsedRule {
  readonly tool: string;
  /** Absent for a bare `Tool` rule, which covers every use of that tool. */
  readonly specifier: string | undefined;
}

export type ParseResult =
  | { readonly ok: true; readonly rule: ParsedRule }
  | { readonly ok: false; readonly reason: string };

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
// Claude Code 2.1.251 embeds these canonical names in its tool inventories.
const KNOWN_TOOL_NAMES: Readonly<Record<string, true>> = {
  Bash: true,
  BashOutput: true,
  KillShell: true,
  PowerShell: true,
  Tmux: true,
  Monitor: true,
  REPL: true,
  JavaScript: true,
  Read: true,
  Edit: true,
  MultiEdit: true,
  Write: true,
  NotebookEdit: true,
  NotebookRead: true,
  Cd: true,
  Glob: true,
  Grep: true,
  LS: true,
  TodoWrite: true,
  TaskCreate: true,
  TaskGet: true,
  TaskList: true,
  TaskUpdate: true,
  TaskStop: true,
  TaskOutput: true,
  LSP: true,
  ReadMcpResourceTool: true,
  ReadMcpResourceDirTool: true,
  ListMcpResourcesTool: true,
  Snip: true,
  WebFetch: true,
  WebSearch: true,
  WebBrowser: true,
  Agent: true,
  AskUserQuestion: true,
  Task: true,
  Workflow: true,
  Skill: true,
  ToolSearch: true,
  WaitForMcpServers: true,
  CronCreate: true,
  CronDelete: true,
  CronList: true,
  ScheduleWakeup: true,
  RemoteTrigger: true,
  EnterPlanMode: true,
  ExitPlanMode: true,
  EndConversation: true,
  EnterWorktree: true,
  ExitWorktree: true,
  SendMessage: true,
  SendUserMessage: true,
  Brief: true,
  PushNotification: true,
  SendFeedback: true,
  SendFile: true,
  SendUserFile: true,
  SubscribePR: true,
  ShareOnboardingGuide: true,
  Artifact: true,
  DesignSync: true,
  ClaudeDesign: true,
  Projects: true,
  ConnectGitHub: true,
  ReportFindings: true,
  ObserverReport: true,
  propose_skills: true,
  RefreshMcpTools: true,
  SuggestPluginInstall: true,
  SuggestConnectors: true,
  SuggestSkills: true,
  ListConnectors: true,
  ListAgents: true,
  ListPeers: true,
  SearchMcpRegistry: true,
  ListPlugins: true,
  ListSkills: true,
  SearchPlugins: true,
  SearchSkills: true,
};
const PRIMARY_CONTENT_FIELDS: Readonly<Record<string, string>> = {
  Bash: "command",
  PowerShell: "command",
  Read: "file_path",
  Edit: "file_path",
  Write: "file_path",
  Grep: "path",
  Glob: "path",
  NotebookEdit: "notebook_path",
  WebFetch: "url",
};
const FILE_PATTERN_TOOLS: Readonly<Record<string, true>> = {
  Read: true,
  Write: true,
  Edit: true,
  Glob: true,
  NotebookRead: true,
  NotebookEdit: true,
  Cd: true,
};
const STAR = "\u0000ESCAPED_STAR\u0000";
const BACKSLASH = "\u0000ESCAPED_BACKSLASH\u0000";

function isMcpToolName(tool: string): boolean {
  const [prefix, server, ...toolSegments] = tool.split("__");
  const toolName = toolSegments.join("__");
  return (
    prefix === "mcp" &&
    server !== undefined &&
    /^[A-Za-z0-9_.*-]+$/.test(server) &&
    (toolSegments.length === 0 || /^[A-Za-z0-9_.*-]+$/.test(toolName))
  );
}

/** Is the character at `index` escaped by an odd run of backslashes? */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 !== 0;
}

export function parseRule(text: string): ParseResult {
  if (text === "") return { ok: false, reason: "empty rule" };
  const open = text.indexOf("(");
  if (open === -1) {
    if (!TOOL_NAME.test(text) && !isMcpToolName(text)) {
      return { ok: false, reason: `tool name contains invalid characters: ${text}` };
    }
    if (KNOWN_TOOL_NAMES[text] !== true && !isMcpToolName(text)) {
      return { ok: false, reason: `unknown tool name: ${text}` };
    }
    return { ok: true, rule: { tool: text, specifier: undefined } };
  }

  const tool = text.slice(0, open);
  if (tool === "") return { ok: false, reason: "empty tool name before the specifier" };
  if (!TOOL_NAME.test(tool) && !isMcpToolName(tool)) {
    return { ok: false, reason: `tool name contains invalid characters: ${tool}` };
  }
  if (KNOWN_TOOL_NAMES[tool] !== true && !isMcpToolName(tool)) {
    return { ok: false, reason: `unknown tool name: ${tool}` };
  }

  let depth = 1;
  let closedAt = -1;
  for (let i = open + 1; i < text.length && closedAt === -1; i++) {
    if (isEscaped(text, i)) continue;
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) closedAt = i;
    }
  }
  if (closedAt === -1) return { ok: false, reason: "mismatched parentheses" };
  if (closedAt !== text.length - 1) {
    return { ok: false, reason: "trailing text follows the specifier" };
  }

  const specifier = text.slice(open + 1, closedAt);
  if (specifier === "") return { ok: false, reason: "empty specifier inside parentheses" };
  if (isMcpToolName(tool)) {
    return {
      ok: false,
      reason: "MCP tool rules do not accept parenthesized specifiers",
    };
  }
  if (specifier.includes(":*") && FILE_PATTERN_TOOLS[tool] === true) {
    return {
      ok: false,
      reason: "the :* suffix is only valid on Bash command prefixes",
    };
  }

  const primaryField = PRIMARY_CONTENT_FIELDS[tool];
  const colon = specifier.indexOf(":");
  if (
    primaryField !== undefined &&
    colon > 0 &&
    specifier.slice(0, colon).trim() === primaryField
  ) {
    return {
      ok: false,
      reason: `${tool} specifier qualifies its raw ${primaryField} field; use the tool matcher directly`,
    };
  }
  return { ok: true, rule: { tool, specifier } };
}

/** Every rule in `rules` the parser rejects, paired with its reason. */
export function invalidRules(
  rules: ReadonlyArray<string>,
): Array<{ rule: string; reason: string }> {
  return rules.flatMap((rule) => {
    const parsed = parseRule(rule);
    return parsed.ok ? [] : [{ rule, reason: parsed.reason }];
  });
}

/**
 * Does `rule` govern `command` run through `tool`? The command is raw text, so
 * a Windows drive root is one backslash here and two inside a rule.
 */
export function ruleMatchesCommand(rule: string, tool: string, command: string): boolean {
  const parsedRule = parseRule(rule);
  if (!parsedRule.ok) return false;
  if (parsedRule.rule.tool !== tool) return false;
  if (parsedRule.rule.specifier === undefined) return true;

  let held = "";
  const specifier = parsedRule.rule.specifier.trim();
  for (let i = 0; i < specifier.length; i++) {
    const next = specifier[i + 1];
    if (specifier[i] === "\\" && (next === "*" || next === "\\")) {
      held += next === "*" ? STAR : BACKSLASH;
      i++;
      continue;
    }
    held += specifier[i];
  }

  // A trailing ` *` that is the rule's only wildcard also matches the bare
  // command, so `Bash(git push --force origin main *)` stops
  // `git push --force origin main` (https://code.claude.com/docs/en/permissions).
  const bareSuffix = held.endsWith(" *") && held.indexOf("*") === held.length - 1;
  const pattern = (bareSuffix ? held.slice(0, -2) : held)
    .replace(/[.+?^${}()|[\]\\'"]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll(STAR, "\\*")
    .replaceAll(BACKSLASH, "\\\\");
  return new RegExp(
    `^${pattern}${bareSuffix ? "(?: .*)?" : ""}$`,
    tool === "PowerShell" ? "si" : "s",
  ).test(command.trim());
}

export type PermissionDecision = "deny" | "ask" | "allow";

const ASSIGNMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The Bash command after its leading `NAME=value` assignments. A value may hold
 * quotes or a `$(...)` substitution with spaces. Returns the input unchanged when
 * no command follows the assignments.
 */
function withoutLeadingAssignments(command: string): string {
  let rest = command.trim();
  while (ASSIGNMENT_NAME.test(rest)) {
    let depth = 0;
    let quote: "'" | '"' | undefined;
    let end = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (quote !== undefined) {
        if (ch === quote) quote = undefined;
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && /\s/.test(ch ?? "")) {
        end = i;
        break;
      }
    }
    const next = rest.slice(end).trim();
    if (next === "") return command.trim();
    rest = next;
  }
  return rest;
}

/**
 * Claude Code's outcome for one command: deny rules first, then ask rules, then
 * allow rules; the first list with a matching rule decides, whatever its order or
 * specificity. Undefined means no rule matched, so the permission mode decides
 * (the auto-mode classifier under the kit's `defaultMode: auto`).
 *
 * Claude Code matches deny and ask rules past any leading variable assignment,
 * and an allow rule only past known-safe ones. The oracle therefore matches a
 * Bash deny or ask rule against the command without its leading assignments,
 * and an allow rule against the raw text. `Bash(HOME=*)` therefore matches a
 * bare `HOME=...` line but not `HOME=... cmd`, which only the classifier sees.
 */
export function permissionDecision(
  permissions: Readonly<Record<PermissionDecision, ReadonlyArray<string>>>,
  tool: string,
  command: string,
): PermissionDecision | undefined {
  const restricted = tool === "Bash" ? withoutLeadingAssignments(command) : command;
  return (["deny", "ask", "allow"] as const).find((list) =>
    permissions[list].some((rule) =>
      ruleMatchesCommand(rule, tool, list === "allow" ? command : restricted),
    ),
  );
}

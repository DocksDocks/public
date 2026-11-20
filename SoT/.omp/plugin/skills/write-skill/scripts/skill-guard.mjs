#!/usr/bin/env node
// skill-guard.mjs — portable SKILL.md validator + the single source of the 16-pt
// scorer rubric. Shipped inside write-skill so the validation loop works in
// consumer repos, AND called by this kit's own CI for scoring — one rubric, no
// author-side-vs-mirror sync contract. Self-contained: Node core only (no `yaml`
// dependency), so it runs anywhere Node does.
//
// Usage:
//   skill-guard.mjs validate [--strict] <skill-dir|skills-root> ...
//   skill-guard.mjs score [--per-file] [skills-root]   # machine output, == kit scorer
import fs from 'node:fs';
import path from 'node:path';

const today = Math.floor(Date.now() / 1000);
const countLines = (lines, re) => lines.reduce((n, l) => (re.test(l) ? n + 1 : n), 0);
const anyLine = (lines, re) => lines.some((l) => re.test(l));

function splitLines(content) {
  return (content.endsWith('\n') ? content.slice(0, -1) : content).split('\n');
}
function bodyAfter(lines) {
  let c = 0; const out = [];
  for (const l of lines) { if (l === '---' && c < 2) { c += 1; continue; } if (c === 2) out.push(l); }
  return out;
}
function dateToTs(d) { const t = Date.parse(`${d}T00:00:00Z`); return Number.isNaN(t) ? 0 : Math.floor(t / 1000); }
function metaUpdated(lines) {
  let inMeta = false;
  for (const l of lines) {
    if (/^metadata:/.test(l)) { inMeta = true; continue; }
    if (inMeta && /^[a-z]/.test(l)) inMeta = false;
    if (inMeta && /updated:/.test(l)) { const m = l.match(/updated:\s*"?([0-9-]*)"?/); return m ? m[1] : ''; }
  }
  return '';
}

// ---- the description value as a YAML parser reads it (Node core only) ----
const indentOf = (l) => /^ */.exec(l)[0].length;
const DQ_ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' };
const endsEscaped = (s) => /(^|[^\\])(\\\\)*\\$/.test(s);
function unescapeDouble(s) {
  return s.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (m, e) => {
    if (e.length === 1) return DQ_ESCAPES[e] ?? m;
    const cp = Number.parseInt(e.slice(1), 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}
// The lines between the frontmatter fences (to the end when the closing fence is missing).
function frontmatter(lines) {
  const start = lines[0] === '---' ? 1 : 0;
  const end = lines.indexOf('---', start);
  return lines.slice(start, end === -1 ? undefined : end);
}
// `|` keeps line breaks, `>` folds them to spaces except around empty and more-indented lines;
// the content indentation (indicator or first text line) is stripped; chomping `-` drops the
// final line break, clip keeps one, `+` keeps it and the trailing empty lines.
function blockScalar(folded, indicator, chomp, rest) {
  const first = rest.find((l) => l.trim() !== '');
  const n = indicator ? Number(indicator) : first === undefined ? 0 : indentOf(first);
  const body = [];
  for (const l of rest) {
    if (l.trim() === '') body.push('');
    else if (n > 0 && indentOf(l) >= n) body.push(l.slice(n));
    else break;
  }
  let end = body.length;
  while (end > 0 && body[end - 1] === '') end -= 1;
  const trailing = body.length - end;
  let text = ''; let prev = null; let empties = 0;
  for (const line of body.slice(0, end)) {
    if (line === '') { empties += 1; continue; }
    if (prev === null) text = '\n'.repeat(empties) + line;
    else if (!folded || /^[ \t]/.test(prev) || /^[ \t]/.test(line)) text += '\n'.repeat(empties + 1) + line;
    else text += (empties === 0 ? ' ' : '\n'.repeat(empties)) + line;
    prev = line; empties = 0;
  }
  if (prev === null) return chomp === '+' ? '\n'.repeat(trailing) : '';
  if (chomp === '-') return text;
  return chomp === '+' ? `${text}\n${'\n'.repeat(trailing)}` : `${text}\n`;
}
// A quoted value up to its closing quote: a line break folds to a space, empty lines become line
// breaks, and the space around a break is dropped; `"` reads escapes (`\` at the end of a line
// joins the next line), `'` reads `''` as one quote.
function quotedScalar(head, rest) {
  const q = head[0];
  const raw = [];
  for (const [i, line] of [head.slice(1), ...rest].entries()) {
    if (i > 0 && line.trim() !== '' && indentOf(line) === 0) break;
    let close = -1;
    for (let c = 0; c < line.length && close === -1; c += 1) {
      if (q === '"' && line[c] === '\\') c += 1;
      else if (line[c] === q && q === "'" && line[c + 1] === "'") c += 1;
      else if (line[c] === q) close = c;
    }
    raw.push(close === -1 ? line : line.slice(0, close));
    if (close !== -1) break;
  }
  const decode = q === '"' ? unescapeDouble : (s) => s.replaceAll("''", "'");
  const parts = raw.map((line, i) => {
    let text = i === 0 ? line : line.replace(/^[ \t]+/, '');
    if (i === raw.length - 1) return { text, joined: false };
    if (q === '"' && endsEscaped(text)) return { text: text.slice(0, -1), joined: true };
    const trimmed = text.replace(/[ \t]+$/, '');
    text = q === '"' && endsEscaped(trimmed) ? text.slice(0, trimmed.length + 1) : trimmed;
    return { text, joined: false };
  });
  let value = decode(parts[0].text); let prev = parts[0]; let empties = 0;
  for (const [i, part] of parts.entries()) {
    if (i === 0) continue;
    if (part.text === '' && i < parts.length - 1) { empties += 1; continue; }
    value += (prev.joined || empties > 0 ? '' : ' ') + '\n'.repeat(empties) + decode(part.text);
    prev = part; empties = 0;
  }
  return value;
}
// A plain value: it ends at a ` #` comment or a less-indented line; lines fold as in quotes.
function plainScalar(head, rest) {
  const texts = []; let comment = false;
  for (const [i, line] of [head, ...rest].entries()) {
    if (i > 0 && line.trim() !== '' && indentOf(line) === 0) break;
    const hash = /(^|[ \t])#/.exec(line);
    texts.push((hash ? line.slice(0, hash.index) : line).trim());
    if (hash) { comment = true; break; }
  }
  let value = ''; let empties = 0;
  for (const t of texts) {
    if (t === '') { empties += 1; continue; }
    value += value === '' ? t : (empties === 0 ? ' ' : '\n'.repeat(empties)) + t;
    empties = 0;
  }
  return { value, comment };
}
// The top-level description value of the frontmatter: { value, comment, node }; comment is true
// when a plain value holds a ` #` comment; node is true when the value starts with a YAML alias
// (`*`), anchor (`&`), or tag (`!`), which this reader does not resolve.
function readDescription(lines) {
  const fm = frontmatter(lines);
  const at = fm.findIndex((l) => /^description:/.test(l));
  if (at === -1) return { value: '', comment: false, node: false };
  const head = fm[at].slice('description:'.length).trim();
  const rest = fm.slice(at + 1);
  const block = /^([|>])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:[ \t]+#.*)?$/.exec(head);
  if (block) return { value: blockScalar(block[1] === '>', block[2] || block[5], block[3] || block[4], rest), comment: false, node: false };
  if (head.startsWith('"') || head.startsWith("'")) return { value: quotedScalar(head, rest), comment: false, node: false };
  const plain = plainScalar(head, rest);
  return { ...plain, node: /^[*&!]/.test(plain.value) };
}

// ---- the 16-pt scorer (single source of the docks rubric) ----
function scoreSkill(file) {
  const lines = splitLines(fs.readFileSync(file, 'utf8'));
  let points = 0;
  const hasUpstream = countLines(lines, /^upstream:/);
  const descLine = lines.find((l) => /^description:/.test(l)) || '';
  let desc = descLine.replace(/^description:\s*/, '');
  desc = desc.replace(/^"/, '').replace(/"$/, '').replace(/^'/, '').replace(/'$/, '');
  const descLen = [...desc].length;
  if (hasUpstream > 0) { if (/use when/i.test(desc)) points += 2; } else if (/^use when/i.test(desc)) points += 2;
  if (descLen > 0 && descLen <= 500) points += 2; else if (descLen > 0 && descLen <= 1000) points += 1;
  const updated = metaUpdated(lines) || (hasUpstream > 0 ? upstreamVendored(lines) : '');
  if (updated) { const ts = dateToTs(updated); if (ts > 0 && Math.floor((today - ts) / 86400) <= 180) points += 1; }
  points += Math.min(3, countLines(lines, /<constraint>/));
  const bad = anyLine(lines, /\bBAD\b|\/\/\s*BAD|#\s*BAD/);
  const good = anyLine(lines, /\bGOOD\b|\/\/\s*GOOD|#\s*GOOD/);
  if ((bad && good) || (anyLine(lines, /wrong fix/i) && anyLine(lines, /right fix/i))) points += 2;
  points += Math.max(0, 2 - slopCount(lines));
  if (anyLine(lines, /^\|.*\|/)) points += 1;
  if (anyLine(lines, /^```[a-z]+/)) points += 1;
  const bl = bodyAfter(lines).length;
  if (bl >= 80 && bl <= 310) points += 2;
  return points;
}
function upstreamVendored(lines) {
  let inUp = false;
  for (const l of lines) {
    if (/^upstream:/.test(l)) { inUp = true; continue; }
    if (inUp && /^[a-z]/.test(l)) inUp = false;
    if (inUp && /vendored_at:/.test(l)) { const m = l.match(/vendored_at:\s*"?([0-9-]*)"?/); return m ? m[1] : ''; }
  }
  return '';
}
function slopCount(lines) {
  let inFence = false; const sl = [];
  for (const l of lines) { if (/^```/.test(l)) { inFence = !inFence; continue; } if (!inFence) sl.push(l.replace(/`[^`]*`/g, '')); }
  return countLines(sl, /\b(comprehensive|robust|elegant|seamless)\b/i);
}

function findSkillFiles(root) {
  const out = [];
  (function walk(d) {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full); else if (e.name === 'SKILL.md') out.push(full);
    }
  })(root);
  return out.sort();
}

// ---- consumer validator: frontmatter + structure checks ----
function validate(dirs, strict) {
  let fails = 0; let warns = 0; let checked = 0;
  const fail = (m) => { console.log(`  FAIL: ${m}`); fails += 1; };
  const warn = (m) => { if (strict) { console.log(`  FAIL(strict): ${m}`); fails += 1; } else { console.log(`  WARN: ${m}`); warns += 1; } };

  function check(dir) {
    const file = path.join(dir, 'SKILL.md');
    console.log(`== ${dir}`);
    checked += 1;
    const content = fs.readFileSync(file, 'utf8');
    const lines = splitLines(content);
    if (lines[0] !== '---') fail('SKILL.md must start with YAML frontmatter fence ---');
    else if (!lines.slice(1).some((l) => l === '---')) fail('frontmatter fence is not closed');

    const dirname = path.basename(dir);
    let name = (lines.find((l) => /^name:/.test(l)) || '').replace(/^name:\s*/, '').replace(/^["']|["']$/g, '');
    if (!name) name = dirname;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`name '${name}' must be lowercase hyphen-case`);
    if ([...name].length > 64) fail(`name exceeds 64 chars (${[...name].length})`);
    if (name !== dirname) fail(`name '${name}' must match directory '${dirname}'`);

    const description = readDescription(lines);
    const desc = description.value;
    const hasUpstream = countLines(lines, /^upstream:/);
    if (description.node) fail('description must be a plain, quoted, or block scalar string (no YAML alias, anchor, or tag)');
    else if (!desc) fail('description must be non-empty');
    else {
      if ([...desc].length > 1024) fail(`description exceeds 1024 chars (${[...desc].length})`);
      if (description.comment) fail("unquoted description contains '#' — quote it (YAML reads ' #' as the start of a comment)");
      if ([...desc].length > 500) warn(`description is ${[...desc].length} chars (>500 crowds the aggregate listing budget)`);
      if (hasUpstream > 0) { if (!/use when/i.test(desc)) warn("description should contain 'Use when'"); }
      else if (!/^use when/i.test(desc)) warn("description should start with 'Use when'");
    }
    if (!anyLine(lines, /^user-invocable:\s*(true|false)/)) warn("frontmatter 'user-invocable' missing");
    const updated = metaUpdated(lines);
    if (!updated) { if (hasUpstream === 0) warn('metadata.updated missing (YYYY-MM-DD)'); }
    else { const ts = dateToTs(updated); if (ts > 0) { const age = Math.floor((today - ts) / 86400); if (age > 180) warn(`metadata.updated is ${age}d old (>180d reads stale)`); } }

    const bl = bodyAfter(lines).length;
    if (bl > 500) fail(`body is ${bl} lines (hard cap 500) — extract detail into references/`);
    if (bl < 80 || bl > 310) warn(`body is ${bl} lines, outside the 80-310 target (agentskills.io: keep the body under 5000 tokens and 500 lines)`);

    const refDir = path.join(dir, 'references');
    if (fs.existsSync(refDir) && fs.statSync(refDir).isDirectory()) {
      if (fs.readdirSync(refDir, { withFileTypes: true }).some((e) => e.isDirectory())) {
        fail('references/ must stay one level deep (agentskills.io: avoid deep reference chains)');
      }
    }
    const slop = slopCount(lines);
    if (slop > 0) warn(`${slop} slop word(s) in prose (comprehensive/robust/elegant/seamless)`);
    console.log(`  score: ${scoreSkill(file)}/16 (docks rubric; per-file floor set by the project's scoring.json; aim 14+)`);
  }

  for (const a of dirs) {
    if (fs.existsSync(path.join(a, 'SKILL.md'))) check(a);
    else if (fs.existsSync(a) && fs.statSync(a).isDirectory()) {
      const files = findSkillFiles(a);
      if (files.length === 0) { console.error(`FAIL: no SKILL.md found under ${a}`); fails += 1; }
      for (const f of files) check(path.dirname(f));
    } else { console.error(`FAIL: not a directory: ${a}`); fails += 1; }
  }
  if (fails > 0) { console.log(`skill-guard FAILED: ${fails} failure(s), ${warns} warning(s) across ${checked} skill(s)`); process.exit(1); }
  console.log(`skill-guard PASSED: ${checked} skill(s), ${warns} warning(s)`);
}

// ---- score mode: `<name> <score>` or total ----
// Each skill is `<root>/<name>/SKILL.md`, one level below the skills root.
function score(args) {
  const perFile = args.includes('--per-file');
  const root = args.find((a) => !a.startsWith('--')) || path.join(process.cwd(), 'plugins/docks/skills');
  let total = 0;
  for (const skill of fs.readdirSync(root).sort()) {
    const sp = path.join(root, skill);
    if (!fs.statSync(sp).isDirectory()) continue;
    const file = path.join(sp, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const s = scoreSkill(file);
    if (perFile) console.log(`${skill} ${s}`);
    total += s;
  }
  if (!perFile) console.log(total);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'score') score(rest);
else if (cmd === 'validate') {
  const strict = rest.includes('--strict');
  const dirs = rest.filter((a) => a !== '--strict');
  if (dirs.length === 0) { console.error('usage: skill-guard.mjs validate [--strict] <skill-dir|skills-root> ...'); process.exit(2); }
  validate(dirs, strict);
} else { console.error('usage: skill-guard.mjs validate [--strict] <dir>... | score [--per-file] [root]'); process.exit(2); }

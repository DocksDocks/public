/**
 * Shared log/warn/err and dry-run emitters. Prefixes go to stderr with stable
 * ANSI codes; dry-run lines go to stdout.
 */

export function log(msg: string): void {
  process.stderr.write(`\x1b[1;32m[ok]\x1b[0m ${msg}\n`)
}

export function warn(msg: string): void {
  process.stderr.write(`\x1b[1;33m[warn]\x1b[0m ${msg}\n`)
}

export function err(msg: string): void {
  process.stderr.write(`\x1b[1;31m[err]\x1b[0m ${msg}\n`)
}

export function echo(line: string): void {
  process.stdout.write(`${line}\n`)
}

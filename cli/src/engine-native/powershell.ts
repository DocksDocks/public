export function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64")
}

export function decodePowerShellCommand(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf16le")
}

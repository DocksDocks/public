import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  GENERATED_PAYLOAD_BASE64,
  GENERATED_PAYLOAD_PATHS,
  GENERATED_PAYLOAD_TEXT
} from "./generated/sotPayload"

export type PayloadPath = typeof GENERATED_PAYLOAD_PATHS[number]
type TextPayloadPath = Exclude<PayloadPath, "notification.mp3">

export function payloadText(path: TextPayloadPath): string {
  return GENERATED_PAYLOAD_TEXT[path]
}

export function payloadBytes(path: PayloadPath): Buffer {
  if (path === "notification.mp3") return Buffer.from(GENERATED_PAYLOAD_BASE64[path], "base64")
  return Buffer.from(payloadText(path))
}

export function payloadPaths(prefix: string): ReadonlyArray<PayloadPath> {
  return GENERATED_PAYLOAD_PATHS.filter((path) => path.startsWith(prefix))
}

export function payloadDisplayPath(path: PayloadPath, kitHome?: string): string {
  if (kitHome === undefined || !existsSync(join(kitHome, "package.json"))) return `embedded:${path}`
  return `${kitHome.replace(/[\\/]+$/, "")}/${path}`
}

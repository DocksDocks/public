import { posixHost } from "./posix"
import type { HostOs } from "./types"

export const darwin: HostOs = posixHost({
  id: "darwin",
  toolchainOs: "darwin",
  supportsBubblewrap: false,
  packageManagerHints: {
    git: "brew install git",
    jq: "brew install jq",
    curl: "brew install curl",
    ffplay: "brew install ffmpeg"
  }
})

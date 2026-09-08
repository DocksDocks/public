import { posixHost } from "./posix"
import type { HostOs } from "./types"

export const linux: HostOs = posixHost({
  id: "linux",
  toolchainOs: "linux",
  supportsBubblewrap: true,
  packageManagerHints: {
    git: "sudo apt install -y git (or your distro's package manager)",
    jq: "sudo apt install -y jq",
    curl: "sudo apt install -y curl",
    ffplay: "sudo apt install -y ffmpeg"
  }
})

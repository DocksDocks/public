import { posixHost } from "./posix";
import type { HostOs } from "./types";

export const darwin: HostOs = posixHost({
  id: "darwin",
  toolchainOs: "darwin",
  supportsBubblewrap: false,
  // macOS terminals start bash as a login shell. It reads the first existing file of these and never reads .bashrc.
  bashTargets: [".bash_profile", ".bash_login", ".profile"],
  packageManagerHints: {
    git: "brew install git",
    jq: "brew install jq",
    curl: "brew install curl",
    ffplay: "brew install ffmpeg",
  },
});

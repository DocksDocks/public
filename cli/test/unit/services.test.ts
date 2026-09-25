import { describe, expect, it } from "vitest";
import {
  makeDependencyManager,
  makeEngineServices,
  makePlatform,
} from "../../src/engine-native/services";

describe("dependency manager services", () => {
  it("uses the injected platform for install hints unless a platform is requested explicitly", () => {
    const linux = makeDependencyManager(makePlatform("linux"));
    const mac = makeDependencyManager(makePlatform("darwin"));
    expect(linux.spec("git").installHint()).toBe(
      "sudo apt install -y git (or your distro's package manager)",
    );
    expect(mac.spec("git").installHint()).toBe("brew install git");
    expect(mac.spec("git").installHint("linux")).toBe(
      "sudo apt install -y git (or your distro's package manager)",
    );
  });

  it("deduplicates by tool and manager while retaining the first warning context", () => {
    const lines: Array<string> = [];
    const logger = makeEngineServices({
      sinks: { stderr: (chunk) => void lines.push(chunk) },
    }).logger;
    const first = makeDependencyManager(makePlatform("linux"));
    const second = makeDependencyManager(makePlatform("linux"));
    first.warnMissing("git", logger, "Claude sync");
    first.warnMissing("git", logger, "Codex sync");
    first.warnMissing("jq", logger);
    second.warnMissing("git", logger, "Codex sync");
    expect(lines).toEqual([
      "\x1b[1;33m[warn]\x1b[0m git not installed — sudo apt install -y git (or your distro's package manager) (Claude sync)\n",
      "\x1b[1;33m[warn]\x1b[0m jq not installed — sudo apt install -y jq\n",
      "\x1b[1;33m[warn]\x1b[0m git not installed — sudo apt install -y git (or your distro's package manager) (Codex sync)\n",
    ]);
  });
});

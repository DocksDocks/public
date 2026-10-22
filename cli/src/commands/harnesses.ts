import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { checklistPrompt } from "../checklistPrompt";
import { bail } from "../engine";
import {
  engineHome,
  HARNESSES,
  LEGACY_SELECTION,
  loadHarnessSelection,
  writeHarnessSelection,
  type Harness,
} from "../engine-native/harnesses";
import { kitDbFile } from "../engine-native/kitDb";

const DESCRIPTIONS: Record<Harness, string> = {
  claude: "Claude Code user configuration",
  codex: "Codex user configuration",
  agents: "Universal agent skills",
  omp: "Oh My Pi user configuration",
};

export const harnessesCommand = Command.make("harnesses", {}, () =>
  Effect.gen(function* () {
    const home = engineHome(process.env);
    const loaded = yield* Effect.sync(() => loadHarnessSelection(home));
    if (loaded.kind === "unreadable") {
      return yield* bail(`Cannot read ${kitDbFile(home)}: ${loaded.reason}`, 1);
    }
    const stored = loaded.kind === "stored" ? loaded.selection : undefined;
    const selection = stored ?? LEGACY_SELECTION;
    const names = selection.join(", ");

    if (stored === undefined) {
      yield* Console.log(
        `Harness selection: ${names} (no selection is stored yet; the legacy default applies)`,
      );
    } else {
      yield* Console.log(`Harness selection: ${names}`);
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) return;

    const result = yield* checklistPrompt({
      title: "Harnesses",
      message: "Choose what a plain docks-kit sync sets up.",
      note:
        stored === undefined
          ? "Every harness starts ticked. Nothing is stored until you save."
          : undefined,
      items: HARNESSES.map((harness) => ({
        value: harness,
        label: harness,
        description: DESCRIPTIONS[harness],
        // With no stored selection, pre-tick every harness, omp included, so a
        // new machine opts out of omp instead of opting in. A flag-less sync
        // keeps LEGACY_SELECTION until this picker saves a selection.
        checked: (stored ?? HARNESSES).includes(harness),
      })),
      emptySelectionError: "Tick at least one harness.",
    });

    if (result._tag === "Cancelled") {
      yield* Console.log("Harness selection unchanged.");
      return;
    }

    yield* Effect.try({
      try: () => writeHarnessSelection(home, result.values),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    }).pipe(
      Effect.catch((reason) =>
        bail(`Cannot save the harness selection to ${kitDbFile(home)}: ${reason}`, 1),
      ),
    );
    const saved = result.values.join(", ");
    yield* Console.log(`Saved harness selection: ${saved} (${kitDbFile(home)})`);
  }),
).pipe(
  Command.withDescription("Choose the harness selection that drives a flag-less docks-kit sync."),
);

/**
 * Flag grammar and parsing for the Effect CLI layer: flag surfaces derived
 * from caller-supplied command values, argv scanning/normalization,
 * subcommand detection, and the omp passthrough boundary. Pure: surfaces are
 * built from structural command values, so this module never touches Effect
 * CLI globals or process state.
 */

export interface FlagSurface {
  readonly longFlags: ReadonlyArray<string>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly valueFlags: ReadonlyArray<string>;
  readonly repeatableFlags: ReadonlyArray<string>;
}

export interface GlobalFlagSurface extends FlagSurface {
  readonly actionFlags: ReadonlySet<string>;
}

export interface CommandValue {
  readonly name: string;
}

export interface ArgvSurfaces {
  readonly commandSurfaces: ReadonlyMap<string, FlagSurface>;
  readonly globalSurface: GlobalFlagSurface;
}

const flagMetadata = (
  param: unknown,
): {
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly takesValue: boolean;
  readonly repeatable: boolean;
} => {
  let current = param;
  let repeatable = false;

  while (typeof current === "object" && current !== null) {
    if (!("_tag" in current)) break;
    if (current._tag === "Variadic") repeatable = true;
    if (current._tag !== "Single") {
      if (!("param" in current)) break;
      current = current.param;
      continue;
    }

    if (!("name" in current) || typeof current.name !== "string") {
      throw new Error("Effect CLI exposed a flag without a string name");
    }
    if (
      !("aliases" in current) ||
      !Array.isArray(current.aliases) ||
      !current.aliases.every((alias) => typeof alias === "string")
    ) {
      throw new Error(`Effect CLI exposed invalid aliases for --${current.name}`);
    }
    if (
      !("primitiveType" in current) ||
      typeof current.primitiveType !== "object" ||
      current.primitiveType === null ||
      !("_tag" in current.primitiveType) ||
      typeof current.primitiveType._tag !== "string"
    ) {
      throw new Error(`Effect CLI exposed no primitive type for --${current.name}`);
    }
    const aliases: ReadonlyArray<string> = current.aliases;
    return {
      name: current.name,
      aliases,
      takesValue: current.primitiveType._tag !== "Boolean",
      repeatable,
    };
  }

  throw new Error("Effect CLI exposed an unsupported flag parameter");
};

const flagSurface = (params: ReadonlyArray<unknown>): FlagSurface => {
  const longFlags: Array<string> = [];
  const aliases = new Map<string, string>();
  const valueFlags: Array<string> = [];
  const repeatableFlags: Array<string> = [];

  for (const param of params) {
    const metadata = flagMetadata(param);
    const longName = `--${metadata.name}`;
    longFlags.push(longName);
    if (metadata.takesValue) valueFlags.push(longName);
    if (metadata.repeatable) repeatableFlags.push(longName);
    for (const alias of metadata.aliases) aliases.set(`-${alias}`, longName);
  }

  return { longFlags, aliases, valueFlags, repeatableFlags };
};

const buildCommandSurface = (command: CommandValue): FlagSurface => {
  if (!("config" in command)) {
    throw new Error(`Effect CLI did not expose flags for '${command.name}'`);
  }
  const config = command.config;
  if (
    typeof config !== "object" ||
    config === null ||
    !("flags" in config) ||
    !Array.isArray(config.flags)
  ) {
    throw new Error(`Effect CLI did not expose flags for '${command.name}'`);
  }

  return flagSurface(config.flags);
};

const globalSurface = (builtIns: unknown): GlobalFlagSurface => {
  if (!Array.isArray(builtIns)) {
    throw new Error("Effect CLI did not expose its built-in global flags");
  }

  const actionFlags = new Set<string>();
  const flags = builtIns.map((builtIn) => {
    if (
      (typeof builtIn !== "object" && typeof builtIn !== "function") ||
      builtIn === null ||
      !("flag" in builtIn) ||
      !("_tag" in builtIn) ||
      typeof builtIn._tag !== "string"
    ) {
      throw new Error("Effect CLI exposed an unsupported built-in global flag");
    }
    if (builtIn._tag === "Action") {
      // Only a presence-based action is idempotent. `--completions` is an action
      // that takes a value, and Effect 4 would silently keep the first one, which
      // is exactly what the duplicate rule exists to refuse.
      const metadata = flagMetadata(builtIn.flag);
      if (!metadata.takesValue) actionFlags.add(`--${metadata.name}`);
    }
    return builtIn.flag;
  });
  return { ...flagSurface(flags), actionFlags };
};

export const buildSurfaces = (
  commands: ReadonlyArray<CommandValue>,
  builtIns: unknown,
): ArgvSurfaces => {
  // A Map, not a plain object: an object literal answers `toString` and friends from
  // `Object.prototype`, so an unknown subcommand with such a name would slip past the
  // unknown-command guard and dereference a surface that was never built.
  const commandSurfaces: ReadonlyMap<string, FlagSurface> = new Map(
    commands.map((command) => [command.name, buildCommandSurface(command)]),
  );
  return { commandSurfaces, globalSurface: globalSurface(builtIns) };
};

const flagNameOf = (token: string): string => {
  const equals = token.indexOf("=");
  return equals === -1 ? token : token.slice(0, equals);
};

const canonicalFlagName = (name: string, surface: FlagSurface | undefined): string | undefined => {
  if (surface === undefined) return undefined;
  const aliased = surface.aliases.get(name);
  if (aliased !== undefined) return aliased;
  return surface.longFlags.includes(name) ? name : undefined;
};

const declaredFlagName = (
  name: string,
  commandSurface: FlagSurface | undefined,
  surfaces: ArgvSurfaces,
): string | undefined =>
  canonicalFlagName(name, commandSurface) ?? canonicalFlagName(name, surfaces.globalSurface);

const declaredInAnySurface = (name: string, surfaces: ArgvSurfaces): boolean => {
  if (canonicalFlagName(name, surfaces.globalSurface) !== undefined) return true;
  for (const surface of surfaces.commandSurfaces.values()) {
    if (canonicalFlagName(name, surface) !== undefined) return true;
  }
  return false;
};

const takesValueInAnySurface = (name: string, surfaces: ArgvSurfaces): boolean => {
  const globalName = canonicalFlagName(name, surfaces.globalSurface);
  if (globalName !== undefined && surfaces.globalSurface.valueFlags.includes(globalName))
    return true;
  for (const surface of surfaces.commandSurfaces.values()) {
    const canonicalName = canonicalFlagName(name, surface);
    if (canonicalName !== undefined && surface.valueFlags.includes(canonicalName)) return true;
  }
  return false;
};

/** The resolved subcommand word, or undefined at the root. */
export const subcommandName = (
  args: ReadonlyArray<string>,
  surfaces: ArgvSurfaces,
): string | undefined => {
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") return undefined;
    const name = flagNameOf(token);
    if (token === name && takesValueInAnySurface(name, surfaces)) {
      const next = args[index + 1];
      if (next === "--") return undefined;
      if (
        next !== undefined &&
        !(next.startsWith("-") && declaredInAnySurface(flagNameOf(next), surfaces))
      ) {
        index++;
        continue;
      }
    }
    if (!token.startsWith("-")) return token;
  }
  return undefined;
};

export interface ScannedFlag {
  readonly token: string;
  readonly name: string;
  readonly canonicalName: string | undefined;
  readonly hasValue: boolean;
  readonly takesValue: boolean;
}

export interface ArgvNormalization {
  readonly flagIndex: number;
  readonly valueIndex: number;
  readonly token: string;
}

export interface ScannedArgv {
  readonly flags: ReadonlyArray<ScannedFlag>;
  readonly normalizations: ReadonlyArray<ArgvNormalization>;
}

export const scanArgv = (
  args: ReadonlyArray<string>,
  commandSurface: FlagSurface | undefined,
  surfaces: ArgvSurfaces,
): ScannedArgv => {
  const flags: Array<ScannedFlag> = [];
  const normalizations: Array<ArgvNormalization> = [];

  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") break;
    if (!token.startsWith("-")) continue;

    const name = flagNameOf(token);
    const canonicalName = declaredFlagName(name, commandSurface, surfaces);
    let hasValue = token.includes("=");
    const takesValue =
      canonicalName !== undefined &&
      (commandSurface?.valueFlags.includes(canonicalName) === true ||
        surfaces.globalSurface.valueFlags.includes(canonicalName));

    if (!hasValue && takesValue) {
      const next = args[index + 1];
      const nextIsRecognizedFlag =
        next !== undefined &&
        next.startsWith("-") &&
        declaredFlagName(flagNameOf(next), commandSurface, surfaces) !== undefined;
      // A legitimate value may begin with `-`; only a recognized flag proves it is missing.
      if (next !== undefined && next !== "--" && !nextIsRecognizedFlag) {
        hasValue = true;
        if (next.startsWith("-")) {
          // Effect 4's lexer treats any `-`-leading token as an option, so a legitimate
          // dash-leading value only survives in the inline form.
          normalizations.push({
            flagIndex: index,
            valueIndex: index + 1,
            token: `${token}=${next}`,
          });
        }
        index++;
      }
    }

    flags.push({ token, name, canonicalName, hasValue, takesValue });
  }

  return { flags, normalizations };
};

export const normalizeArgv = (
  args: ReadonlyArray<string>,
  normalizations: ReadonlyArray<ArgvNormalization>,
): ReadonlyArray<string> => {
  if (normalizations.length === 0) return args;

  const normalized: Array<string> = [];
  let normalizationIndex = 0;
  for (let index = 0; index < args.length; index++) {
    const normalization = normalizations[normalizationIndex];
    if (normalization !== undefined && normalization.flagIndex === index) {
      normalized.push(normalization.token);
      index = normalization.valueIndex;
      normalizationIndex++;
      continue;
    }
    normalized.push(args[index]);
  }
  return normalized;
};

// Without the injected `--`, Effect 4 rejects a forwarded flag such as `-p` or
// `--mode` as unrecognized. The omp launcher therefore owns a passthrough
// boundary: the first token after the `omp` word that is neither a flag
// declared on the omp or global surface nor a value consumed by such a flag
// starts the verbatim tail forwarded to omp. An undeclared long flag joins the
// tail too, because most omp flags are long (`--mode`, `--continue`,
// `--models`), and omp itself reports an unrecognized one accurately. Use
// `docks-kit omp -- --model x` to reach omp's own same-named flag.
export const spliceOmpBoundary = (
  args: ReadonlyArray<string>,
  surfaces: ArgvSurfaces,
): ReadonlyArray<string> => {
  const surface = surfaces.commandSurfaces.get("omp");
  let ompIndex = -1;
  for (let index = 0; index < args.length; index++) {
    const token = args[index] as string;
    if (token === "--") return args;
    const name = flagNameOf(token);
    if (token === name && takesValueInAnySurface(name, surfaces)) {
      const next = args[index + 1];
      if (next === "--") return args;
      if (
        next !== undefined &&
        !(next.startsWith("-") && declaredInAnySurface(flagNameOf(next), surfaces))
      ) {
        index++;
        continue;
      }
    }
    if (!token.startsWith("-")) {
      ompIndex = index;
      break;
    }
  }
  if (ompIndex === -1 || args[ompIndex] !== "omp") return args;
  for (let index = ompIndex + 1; index < args.length; index++) {
    const token = args[index] as string;
    // An explicit delimiter already marks the tail; a second one would be
    // forwarded to omp as a literal argument.
    if (token === "--") return args;
    if (!token.startsWith("-")) {
      return [...args.slice(0, index), "--", ...args.slice(index)];
    }
    const name = flagNameOf(token);
    const canonical = declaredFlagName(name, surface, surfaces);
    if (canonical === undefined) return [...args.slice(0, index), "--", ...args.slice(index)];
    const takesValue =
      surface?.valueFlags.includes(canonical) === true ||
      surfaces.globalSurface.valueFlags.includes(canonical);
    if (takesValue && !token.includes("=")) {
      const next = args[index + 1];
      if (
        next !== undefined &&
        !(
          next.startsWith("-") &&
          declaredFlagName(flagNameOf(next), surface, surfaces) !== undefined
        )
      ) {
        index++;
      }
    }
  }
  return args;
};

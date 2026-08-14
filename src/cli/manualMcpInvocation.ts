import {
  buildKyosoPackageCommand,
  isCompleteSemVer,
  KYOSO_EXECUTABLE_NAME,
  KYOSO_PACKAGE_ALIAS,
  KYOSO_PACKAGE_ALIAS_PREFIX,
  KYOSO_PACKAGE_NAME,
  type KyosoPackageCommand,
  type KyosoPackageRunner,
} from "./packageRunner.js";

export type ManualMcpInvocationKind =
  "current" | "legacy" | "custom" | "unknown";

export type ManualMcpInvocationInspection = {
  kind: ManualMcpInvocationKind;
  runner?: KyosoPackageRunner;
  packageSpec?: string;
  legacyArgs?: readonly string[];
  replacement?: KyosoPackageCommand;
  reason: string;
};

const GENERATED_MCP_ENV_VALUE_NAMES = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENROUTER_API_KEY",
]);

const GENERATED_MCP_ENV_VAR_NAMES = new Set([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_HOME",
  "CODEX_ACCESS_TOKEN",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
]);

export function inspectManualMcpInvocation(
  value: unknown,
): ManualMcpInvocationInspection {
  if (!isRecord(value)) {
    return { kind: "unknown", reason: "MCP entry is not an object." };
  }
  if (typeof value.command !== "string" || value.command.length === 0) {
    return {
      kind: "unknown",
      reason: "MCP command is missing or is not a string.",
    };
  }
  if (!Array.isArray(value.args) || !value.args.every(isString)) {
    return {
      kind: "unknown",
      reason: "MCP args are missing or are not an array of strings.",
    };
  }
  const environment = inspectMcpEnvironment(value);

  if (value.command === "npx") {
    return applyEnvironmentSafety(inspectNpx(value.args), environment);
  }
  if (value.command === "bunx") {
    return applyEnvironmentSafety(inspectBunx(value.args), environment);
  }
  return {
    kind: "custom",
    reason: `MCP command ${JSON.stringify(value.command)} is not a Kyoso package runner.`,
  };
}

function inspectMcpEnvironment(
  value: Record<string, unknown>,
): ManualMcpInvocationInspection | undefined {
  if ("env" in value && !isGeneratedMcpEnvironment(value.env)) {
    return {
      kind: "custom",
      reason:
        "MCP environment is not limited to generated credential placeholders.",
    };
  }
  if (
    "env_vars" in value &&
    !isGeneratedMcpEnvironmentVariables(value.env_vars)
  ) {
    return {
      kind: "custom",
      reason:
        "MCP environment variable forwarding is not limited to generated credential names.",
    };
  }
  return undefined;
}

function applyEnvironmentSafety(
  invocation: ManualMcpInvocationInspection,
  environment: ManualMcpInvocationInspection | undefined,
): ManualMcpInvocationInspection {
  return environment ?? invocation;
}

function isGeneratedMcpEnvironment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([name, placeholder]) =>
      GENERATED_MCP_ENV_VALUE_NAMES.has(name) && placeholder === `\${${name}}`,
  );
}

function isGeneratedMcpEnvironmentVariables(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(isString)) return false;
  return (
    new Set(value).size === value.length &&
    value.every((name) => GENERATED_MCP_ENV_VAR_NAMES.has(name))
  );
}

// An unaliased explicit form still selects the executable correctly, so it is
// migrated for a different reason than a positional form: the specifier itself
// can resolve a same-named workspace instead of the published package.
const UNALIASED_EXPLICIT_REASON = `Kyoso package runner omits the ${KYOSO_PACKAGE_ALIAS} npm alias, so it can resolve a same-named workspace instead of the published package.`;
const EXECUTABLE_INFERENCE_REASON =
  "Kyoso package runner relies on executable inference with a multi-bin package.";

// Match the package name exactly or up to its version separator, so a different
// package that merely shares the prefix — `@kyo-so/cli-extra` — is not diagnosed
// as a malformed Kyoso pin.
function isKyosoPackageSpec(packageSpec: string): boolean {
  return (
    packageSpec === KYOSO_PACKAGE_NAME ||
    packageSpec.startsWith(`${KYOSO_PACKAGE_NAME}@`)
  );
}

// An explicit argv may or may not carry the alias. Strip it so a tag, range, or
// malformed pin reaches the same diagnosis either way instead of falling through
// to the generic "arguments do not match" reason.
function bareKyosoPackageSpec(packageSpec: string): string | undefined {
  const bare = packageSpec.startsWith(KYOSO_PACKAGE_ALIAS_PREFIX)
    ? packageSpec.slice(KYOSO_PACKAGE_ALIAS_PREFIX.length)
    : packageSpec;
  return isKyosoPackageSpec(bare) ? bare : undefined;
}

function inspectNpx(args: string[]): ManualMcpInvocationInspection {
  const explicit = parseNpxExplicit(args);
  if (explicit !== undefined && isAliasedPackageSpec(explicit)) {
    return {
      kind: "current",
      runner: "npx",
      packageSpec: explicit,
      reason:
        "npx explicitly selects the Kyoso executable from its aliased package.",
    };
  }
  const explicitBare =
    explicit === undefined ? undefined : bareKyosoPackageSpec(explicit);
  if (explicitBare !== undefined) {
    return legacyInspection(
      "npx",
      explicitBare,
      args,
      UNALIASED_EXPLICIT_REASON,
    );
  }

  const legacy = parseNpxLegacy(args);
  if (legacy) {
    return legacyInspection("npx", legacy, args, EXECUTABLE_INFERENCE_REASON);
  }

  return {
    kind: "custom",
    runner: "npx",
    reason: "npx arguments do not exactly match a supported Kyoso invocation.",
  };
}

function inspectBunx(args: string[]): ManualMcpInvocationInspection {
  const explicit = parseBunxExplicit(args);
  if (explicit !== undefined && isAliasedPackageSpec(explicit)) {
    return {
      kind: "current",
      runner: "bunx",
      packageSpec: explicit,
      reason:
        "bunx explicitly selects the Kyoso executable from its aliased package.",
    };
  }
  const explicitBare =
    explicit === undefined ? undefined : bareKyosoPackageSpec(explicit);
  if (explicitBare !== undefined) {
    return legacyInspection(
      "bunx",
      explicitBare,
      args,
      UNALIASED_EXPLICIT_REASON,
    );
  }

  const legacy = parseBunxLegacy(args);
  if (legacy) {
    return legacyInspection("bunx", legacy, args, EXECUTABLE_INFERENCE_REASON);
  }

  return {
    kind: "custom",
    runner: "bunx",
    reason: "bunx arguments do not exactly match a supported Kyoso invocation.",
  };
}

function legacyInspection(
  runner: KyosoPackageRunner,
  packageSpec: string,
  legacyArgs: readonly string[],
  reason: string,
): ManualMcpInvocationInspection {
  const version = versionFromKnownPackageSpec(packageSpec);
  // A spec we cannot pin has no safe replacement to migrate to, so it is custom
  // rather than legacy. The caller's `reason` is deliberately dropped here: it
  // describes the argv shape, and reporting "the alias is missing" about
  // `kyoso-cli@npm:@kyo-so/cli@latest` — which carries the alias — would be
  // false. What blocks this entry is the spec, so the spec is what we name.
  if (version === undefined && packageSpec !== KYOSO_PACKAGE_NAME) {
    return {
      kind: "custom",
      runner,
      packageSpec,
      reason:
        "Kyoso package spec is a tag, range, or malformed pin and is preserved.",
    };
  }
  return {
    kind: "legacy",
    runner,
    packageSpec,
    legacyArgs: [...legacyArgs],
    replacement: buildKyosoPackageCommand({
      runner,
      ...(version === undefined ? {} : { version }),
      cliArgs: ["mcp"],
    }),
    reason,
  };
}

function parseNpxExplicit(args: string[]): string | undefined {
  if (
    args.length !== 4 ||
    args[0] !== "-y" ||
    args[2] !== KYOSO_EXECUTABLE_NAME ||
    args[3] !== "mcp"
  ) {
    return undefined;
  }
  return args[1]?.startsWith("--package=")
    ? args[1].slice("--package=".length)
    : undefined;
}

function parseBunxExplicit(args: string[]): string | undefined {
  if (
    args.length !== 4 ||
    args[0] !== "--package" ||
    args[2] !== KYOSO_EXECUTABLE_NAME ||
    args[3] !== "mcp"
  ) {
    return undefined;
  }
  return args[1];
}

function parseNpxLegacy(args: string[]): string | undefined {
  const packageIndex = args[0] === "-y" ? 1 : 0;
  if (args.length !== packageIndex + 2 || args[packageIndex + 1] !== "mcp") {
    return undefined;
  }
  const packageSpec = args[packageIndex];
  return packageSpec && isKyosoPackageSpec(packageSpec)
    ? packageSpec
    : undefined;
}

function parseBunxLegacy(args: string[]): string | undefined {
  if (args.length !== 2 || args[1] !== "mcp") return undefined;
  const packageSpec = args[0];
  return packageSpec && isKyosoPackageSpec(packageSpec)
    ? packageSpec
    : undefined;
}

function isAliasedPackageSpec(packageSpec: string): boolean {
  if (!packageSpec.startsWith(KYOSO_PACKAGE_ALIAS_PREFIX)) return false;
  return isPublishedPackageSpec(
    packageSpec.slice(KYOSO_PACKAGE_ALIAS_PREFIX.length),
  );
}

function isPublishedPackageSpec(packageSpec: string): boolean {
  return (
    packageSpec === KYOSO_PACKAGE_NAME ||
    versionFromKnownPackageSpec(packageSpec) !== undefined
  );
}

function versionFromKnownPackageSpec(packageSpec: string): string | undefined {
  const prefix = `${KYOSO_PACKAGE_NAME}@`;
  if (!packageSpec.startsWith(prefix)) return undefined;
  const version = packageSpec.slice(prefix.length);
  return isCompleteSemVer(version) ? version : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

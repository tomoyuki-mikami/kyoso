import { describe, expect, test } from "bun:test";
import { inspectManualMcpInvocation } from "../../src/cli/manualMcpInvocation.js";

describe("manual MCP invocation classifier", () => {
  test.each([
    [
      "current npx",
      "npx",
      ["-y", "--package=kyoso-cli@npm:@kyo-so/cli", "kyoso", "mcp"],
      "current",
    ],
    [
      "current pinned npx",
      "npx",
      ["-y", "--package=kyoso-cli@npm:@kyo-so/cli@0.13.1", "kyoso", "mcp"],
      "current",
    ],
    [
      "current bunx",
      "bunx",
      ["--package", "kyoso-cli@npm:@kyo-so/cli", "kyoso", "mcp"],
      "current",
    ],
    [
      "legacy explicit npx",
      "npx",
      ["-y", "--package=@kyo-so/cli", "kyoso", "mcp"],
      "legacy",
    ],
    [
      "legacy explicit bunx",
      "bunx",
      ["--package", "@kyo-so/cli", "kyoso", "mcp"],
      "legacy",
    ],
    ["legacy npx", "npx", ["-y", "@kyo-so/cli", "mcp"], "legacy"],
    ["legacy npx without yes", "npx", ["@kyo-so/cli@0.13.1", "mcp"], "legacy"],
    ["legacy bunx", "bunx", ["@kyo-so/cli@0.13.1", "mcp"], "legacy"],
    ["tag", "npx", ["-y", "@kyo-so/cli@latest", "mcp"], "custom"],
    ["range", "bunx", ["@kyo-so/cli@^0.13.1", "mcp"], "custom"],
    [
      "wrong executable",
      "npx",
      ["-y", "--package=@kyo-so/cli", "cli", "mcp"],
      "custom",
    ],
    [
      "extra arg",
      "bunx",
      ["--package", "@kyo-so/cli", "kyoso", "--verbose", "mcp"],
      "custom",
    ],
  ] as const)("classifies %s", (_label, command, args, expectedKind) => {
    expect(inspectManualMcpInvocation({ command, args }).kind).toBe(
      expectedKind,
    );
  });

  test("only exposes a replacement for exact legacy forms", () => {
    expect(
      inspectManualMcpInvocation({
        command: "npx",
        args: ["-y", "@kyo-so/cli@0.13.1", "mcp"],
      }),
    ).toMatchObject({
      kind: "legacy",
      replacement: {
        command: "npx",
        args: [
          "-y",
          "--package=kyoso-cli@npm:@kyo-so/cli@0.13.1",
          "kyoso",
          "mcp",
        ],
      },
    });
    expect(
      inspectManualMcpInvocation({
        command: "npx",
        args: ["-y", "@kyo-so/cli@latest", "mcp"],
      }).replacement,
    ).toBeUndefined();
  });

  test("distinguishes why each legacy form is migrated", () => {
    expect(
      inspectManualMcpInvocation({
        command: "npx",
        args: ["-y", "--package=@kyo-so/cli@0.13.1", "kyoso", "mcp"],
      }),
    ).toMatchObject({
      kind: "legacy",
      reason:
        "Kyoso package runner omits the kyoso-cli npm alias, so it can resolve a same-named workspace instead of the published package.",
      replacement: {
        command: "npx",
        args: [
          "-y",
          "--package=kyoso-cli@npm:@kyo-so/cli@0.13.1",
          "kyoso",
          "mcp",
        ],
      },
    });
    expect(
      inspectManualMcpInvocation({
        command: "bunx",
        args: ["@kyo-so/cli@0.13.1", "mcp"],
      }),
    ).toMatchObject({
      kind: "legacy",
      reason:
        "Kyoso package runner relies on executable inference with a multi-bin package.",
      replacement: {
        command: "bunx",
        args: ["--package", "kyoso-cli@npm:@kyo-so/cli@0.13.1", "kyoso", "mcp"],
      },
    });
  });

  test("diagnoses an explicit tag by its spec, aliased or not", () => {
    const tagReason =
      "Kyoso package spec is a tag, range, or malformed pin and is preserved.";
    expect(
      inspectManualMcpInvocation({
        command: "npx",
        args: [
          "-y",
          "--package=kyoso-cli@npm:@kyo-so/cli@latest",
          "kyoso",
          "mcp",
        ],
      }),
    ).toMatchObject({ kind: "custom", reason: tagReason });
    expect(
      inspectManualMcpInvocation({
        command: "bunx",
        args: ["--package", "@kyo-so/cli@^0.13.1", "kyoso", "mcp"],
      }),
    ).toMatchObject({ kind: "custom", reason: tagReason });
  });

  // A package whose name merely starts with the Kyoso one is not Kyoso, so the
  // pin diagnosis above must not claim its version is a bad Kyoso pin. Both
  // spellings land on `custom`, so only the reason separates them and nothing
  // else here would notice the boundary moving back.
  test("does not diagnose a prefix-only package name as a Kyoso pin", () => {
    expect(
      inspectManualMcpInvocation({
        command: "npx",
        args: ["-y", "@kyo-so/cli-extra@1.0.0", "mcp"],
      }),
    ).toMatchObject({
      kind: "custom",
      reason:
        "npx arguments do not exactly match a supported Kyoso invocation.",
    });
  });

  // Only the explicit argv strips the alias before diagnosing the spec, so a
  // positional argv carrying one is `custom` rather than `legacy` and gets no
  // repair command. The alias did not exist before this change, so no
  // pre-alias registration can reach this path; this pins the accepted
  // asymmetry so a later change to either parser has to face it deliberately.
  test("treats a positional argv carrying the alias as custom", () => {
    for (const invocation of [
      { command: "npx", args: ["-y", "kyoso-cli@npm:@kyo-so/cli", "mcp"] },
      { command: "bunx", args: ["kyoso-cli@npm:@kyo-so/cli", "mcp"] },
    ]) {
      const inspected = inspectManualMcpInvocation(invocation);
      expect(inspected.kind).toBe("custom");
      // The other half of the decision: no repair command is offered for it.
      expect(inspected).not.toHaveProperty("replacement");
    }
  });

  test("keeps generated credential placeholders current", () => {
    expect(
      inspectManualMcpInvocation({
        command: "npx",
        args: ["-y", "--package=kyoso-cli@npm:@kyo-so/cli", "kyoso", "mcp"],
        env: {
          OPENAI_API_KEY: "${OPENAI_API_KEY}",
          ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}",
        },
      }).kind,
    ).toBe("current");
    expect(
      inspectManualMcpInvocation({
        command: "bunx",
        args: ["--package", "kyoso-cli@npm:@kyo-so/cli", "kyoso", "mcp"],
        env_vars: ["OPENAI_API_KEY", "CODEX_ACCESS_TOKEN"],
      }).kind,
    ).toBe("current");
  });

  test.each([
    ["environment mapping", { NODE_OPTIONS: "--require /tmp/payload.js" }],
    ["environment forwarding", ["npm_config_registry"]],
  ] as const)(
    "classifies execution-altering %s as custom",
    (_label, environment) => {
      const entry = {
        command: "npx",
        args: ["-y", "--package=kyoso-cli@npm:@kyo-so/cli", "kyoso", "mcp"],
        ...(Array.isArray(environment)
          ? { env_vars: environment }
          : { env: environment }),
      };
      expect(inspectManualMcpInvocation(entry)).toMatchObject({
        kind: "custom",
      });
    },
  );

  test("does not expose a replacement for legacy argv with an unsafe environment", () => {
    const inspection = inspectManualMcpInvocation({
      command: "npx",
      args: ["-y", "@kyo-so/cli", "mcp"],
      env: { NODE_OPTIONS: "--require /tmp/payload.js" },
    });
    expect(inspection).toMatchObject({
      kind: "custom",
    });
    expect(inspection.replacement).toBeUndefined();
  });

  test("classifies malformed values as unknown", () => {
    expect(
      inspectManualMcpInvocation({ command: "npx", args: ["mcp", 1] }),
    ).toMatchObject({
      kind: "unknown",
    });
    expect(inspectManualMcpInvocation({ args: [] })).toMatchObject({
      kind: "unknown",
    });
  });
});

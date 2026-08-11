import { describe, expect, test } from "bun:test";
import { resolveLaunchArgs } from "../../src/acp/AcpAgentProcess.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { collectProjectScopeViolations } from "../../src/config/projectScope.js";
import { kyosoConfigSchema } from "../../src/config/schema.js";
import { buildChildEnv, buildChildLaunchContext } from "../../src/utils/env.js";

describe("qwen agent config", () => {
  test("is disabled by default with a pinned adapter version", () => {
    const parsed = kyosoConfigSchema.parse(defaultConfig);

    expect(parsed.agents.qwen.enabled).toBe(false);
    expect(parsed.agents.qwen.command).toBe("npx");
    expect(parsed.agents.qwen.args).toEqual([
      "-y",
      "@qwen-code/qwen-code@0.21.9",
      "--acp",
    ]);
    expect(parsed.agents.qwen.role).toBe("implementation_reviewer");
    expect(parsed.agents.qwen.auth.envWhitelist).toEqual([
      "OPENROUTER_API_KEY",
    ]);
  });

  test("requires a model when qwen is enabled", () => {
    const withoutModel = kyosoConfigSchema.safeParse({
      ...defaultConfig,
      agents: {
        ...defaultConfig.agents,
        qwen: { ...defaultConfig.agents?.qwen, enabled: true },
      },
    });
    const withModel = kyosoConfigSchema.safeParse({
      ...defaultConfig,
      agents: {
        ...defaultConfig.agents,
        qwen: {
          ...defaultConfig.agents?.qwen,
          enabled: true,
          model: "qwen/qwen3-coder",
        },
      },
    });

    expect(withoutModel.success).toBe(false);
    expect(withModel.success).toBe(true);
    if (!withoutModel.success) {
      expect(JSON.stringify(withoutModel.error.issues)).toContain(
        "qwen_model_required",
      );
    }
  });
});

describe("qwen child environment", () => {
  test("forwards OPENROUTER_API_KEY and sets the OpenRouter base URL", () => {
    const key = "qwen-openrouter-child-key";
    const context = buildChildLaunchContext(
      { PATH: "/bin", OPENROUTER_API_KEY: key },
      ["OPENROUTER_API_KEY"],
      { KYOSO_CHILD_AGENT: "1" },
      { agent: "qwen", model: "qwen/qwen3-coder" },
    );

    expect(context.env.OPENROUTER_API_KEY).toBe(key);
    expect(context.env.OPENAI_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(context.executionIdentity).toEqual({
      providerRoute: "openrouter",
      requestedModel: "qwen/qwen3-coder",
      reportingStatus: "requested_only",
    });
  });

  test("pins OPENAI_BASE_URL to OpenRouter even when overridden", () => {
    const env = buildChildEnv(
      { PATH: "/bin", OPENROUTER_API_KEY: "key" },
      [],
      { OPENAI_BASE_URL: "https://proxy.example.test/v1" },
      { agent: "qwen", model: "qwen/qwen3-coder" },
    );

    expect(env.OPENAI_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });

  test("strips foreign provider credentials from the qwen child env", () => {
    const env = buildChildEnv(
      {
        PATH: "/bin",
        OPENROUTER_API_KEY: "key",
        OPENAI_API_KEY: "openai-key",
        ANTHROPIC_API_KEY: "anthropic-key",
      },
      ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      { OPENAI_API_KEY: "explicit-openai-key" },
      { agent: "qwen", model: "qwen/qwen3-coder" },
    );

    expect(env.OPENROUTER_API_KEY).toBe("key");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.CODEX_ACCESS_TOKEN).toBeUndefined();
  });

  test("fails preflight when OPENROUTER_API_KEY is missing", () => {
    expect(() =>
      buildChildEnv(
        { PATH: "/bin" },
        [],
        {},
        { agent: "qwen", model: "qwen/qwen3-coder" },
      ),
    ).toThrow("OPENROUTER_API_KEY");
  });

  test("fails preflight when the qwen model is missing", () => {
    expect(() =>
      buildChildEnv(
        { PATH: "/bin", OPENROUTER_API_KEY: "key" },
        [],
        {},
        { agent: "qwen" },
      ),
    ).toThrow("agents.qwen.model");
  });

  test("still withholds OPENROUTER_API_KEY from codex and claude defaults", () => {
    const codex = buildChildEnv(
      { PATH: "/bin", OPENROUTER_API_KEY: "key" },
      ["OPENROUTER_API_KEY"],
      {},
      { agent: "codex" },
    );
    const claude = buildChildEnv(
      { PATH: "/bin", OPENROUTER_API_KEY: "key" },
      ["OPENROUTER_API_KEY"],
      {},
      { agent: "claude" },
    );

    expect(codex.OPENROUTER_API_KEY).toBeUndefined();
    expect(claude.OPENROUTER_API_KEY).toBeUndefined();
  });
});

describe("qwen project scope", () => {
  test("rejects enabling qwen or setting its model from project config", () => {
    const violations = collectProjectScopeViolations({
      agents: { qwen: { enabled: true, model: "qwen/qwen3-coder" } },
    });

    expect(violations.map((violation) => violation.path)).toEqual([
      "agents.qwen.enabled",
      "agents.qwen.model",
    ]);
    for (const violation of violations) {
      expect(violation.reason).toContain("user global config");
    }
  });

  test("still allows qwen timeout tuning from project config", () => {
    expect(
      collectProjectScopeViolations({
        agents: { qwen: { timeoutMs: 120_000 } },
      }),
    ).toEqual([]);
  });
});

describe("qwen launch args", () => {
  test("appends --model for qwen only", () => {
    const args = ["-y", "@qwen-code/qwen-code@0.21.9", "--acp"];

    expect(
      resolveLaunchArgs("qwen", { args, model: "qwen/qwen3-coder" }),
    ).toEqual([...args, "--model", "qwen/qwen3-coder"]);
    expect(resolveLaunchArgs("qwen", { args })).toEqual(args);
    expect(
      resolveLaunchArgs("codex", { args: ["-y", "codex-acp"], model: "gpt" }),
    ).toEqual(["-y", "codex-acp"]);
  });
});

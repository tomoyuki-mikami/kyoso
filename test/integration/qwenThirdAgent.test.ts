import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentManager } from "../../src/acp/FakeAgentManager.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import {
  kyosoConfigSchema,
  type KyosoConfig,
} from "../../src/config/schema.js";
import { runReview } from "../../src/core/runReview.js";

describe("qwen as a third review agent", () => {
  test("runs all three agents and aggregates three opinions", async () => {
    const config = threeAgentConfig();
    const manager = new FakeAgentManager();

    const result = await runReview(
      "plan_review",
      { goal: "review plan" },
      { cwd: await tempCwd(), config, agentManager: manager },
    );

    const primaryCalls = manager.calls.filter(
      (call) => call.role !== "finding_verifier",
    );
    expect(primaryCalls.map((call) => call.agent).sort()).toEqual([
      "claude",
      "codex",
      "qwen",
    ]);
    expect(result.reviewMode).toBe("multi_agent");
    expect(result.agentsUsed.sort()).toEqual(["claude", "codex", "qwen"]);
    expect(result.agentOpinions).toHaveLength(3);
    const qwenOpinion = result.agentOpinions.find(
      (opinion) => opinion.agent === "qwen",
    );
    expect(qwenOpinion).toMatchObject({
      agent: "qwen",
      role: "implementation_reviewer",
      status: "completed",
    });
    expect(result.executionBudget.modelCalls.consumed).toBe(3);
    expect(result.testsToAdd.join("\n")).toContain("qwen");
  });

  test("does not launch qwen when it stays disabled", async () => {
    const config = kyosoConfigSchema.parse(defaultConfig);
    const manager = new FakeAgentManager();

    const result = await runReview(
      "plan_review",
      { goal: "review plan" },
      { cwd: await tempCwd(), config, agentManager: manager },
    );

    expect(manager.calls.some((call) => call.agent === "qwen")).toBe(false);
    expect(result.agentOpinions).toHaveLength(2);
    expect(
      result.agentOpinions.some((opinion) => opinion.agent === "qwen"),
    ).toBe(false);
  });
});

function threeAgentConfig(): KyosoConfig {
  return kyosoConfigSchema.parse({
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
}

async function tempCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kyoso-qwen-third-agent-"));
}

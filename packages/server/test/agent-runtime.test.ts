import { describe, expect, test } from "bun:test"
import { Harness } from "@opencode/schema/harness"
import { AbsolutePath } from "@opencode/schema/schema"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { agentRuntime, agentRuntimes } from "../src/agent-runtime/registry"
import { createAgentRuntimeSupervisor } from "../src/agent-runtime/supervisor"

function run(driver: Harness.Driver): Harness.Run {
  return {
    id: "run",
    driver,
    directory: AbsolutePath.make("/workspace"),
    state: "starting",
    createdAt: "2026-11-08T00:00:00.000Z",
    queued: 0,
    capabilities: { interrupt: true, resume: true, steer: driver === "codex" },
    model: driver === "claude" ? "claude-opus" : "gpt-codex",
    nativeID: "native-session",
  }
}

describe("agent runtime registry", () => {
  test("registers each provider once and exposes honest harness capabilities", () => {
    expect(agentRuntimes().map((adapter) => adapter.driver).sort()).toEqual(["claude", "codex"])
    expect(agentRuntime("codex").capabilities).toMatchObject({
      interrupt: true,
      multipleThreadsPerRuntime: true,
      resumeAfterRestart: true,
      steer: true,
    })
    expect(agentRuntime("claude").capabilities).toMatchObject({
      interrupt: true,
      multipleThreadsPerRuntime: false,
      resumeAfterRestart: true,
      steer: false,
    })
  })

  test("keeps provider process arguments behind the adapter boundary", () => {
    const args = agentRuntime("claude").launchArgs(run("claude"))
    expect(args).toContain("--resume")
    expect(args).toContain("native-session")
    expect(args).toContain("--model")
    expect(args).toContain("claude-opus")
    expect(args).toContain("stream-json")
    expect(agentRuntime("codex").launchArgs(run("codex"))).toEqual(["app-server"])
  })
})

describe("agent runtime event normalization", () => {
  test("scopes Codex frames and normalizes requests, usage and completion", () => {
    const adapter = agentRuntime("codex")
    const runtime = run("codex")
    expect(
      adapter.accepts({
        run: runtime,
        turn: "turn-1",
        frame: { method: "item/agentMessage/delta", params: { threadId: "foreign", delta: "ignore" } },
      }),
    ).toBeFalse()
    expect(
      adapter.events({
        run: runtime,
        turn: "turn-1",
        frame: {
          id: 7,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "native-session",
            turnId: "turn-1",
            questions: [{ id: "choice", question: "Choose", options: [{ label: "Small" }] }],
          },
        },
      }),
    ).toMatchObject([
      {
        type: "request",
        key: "7",
        supported: true,
        questions: [{ id: "choice", text: "Choose", options: ["Small"] }],
      },
    ])
    expect(
      adapter.events({
        run: runtime,
        turn: "turn-1",
        frame: {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "native-session",
            tokenUsage: {
              total: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 30, reasoningOutputTokens: 5 },
            },
          },
        },
      }),
    ).toMatchObject([
      { type: "usage", metric: { tokens: { input: 20, output: 25, reasoning: 5, cache: { read: 80 } } } },
    ])
    expect(
      adapter.events({
        run: runtime,
        turn: "turn-1",
        frame: {
          method: "turn/completed",
          params: { threadId: "native-session", turn: { id: "turn-1", status: "completed" } },
        },
      }),
    ).toMatchObject([{ type: "completed", outcome: "completed", metrics: [{ status: "succeeded" }] }])
  })

  test("normalizes Claude text, permissions and cumulative usage", () => {
    const adapter = agentRuntime("claude")
    const runtime = run("claude")
    expect(
      adapter.events({
        run: runtime,
        turn: "",
        frame: {
          type: "assistant",
          message: { content: [{ type: "text", text: "done" }, { type: "tool_use", name: "Bash" }] },
          parent_tool_use_id: null,
        },
      }),
    ).toEqual([
      { type: "text", text: "done" },
      { type: "activity", text: "Bash" },
    ])
    expect(
      adapter.events({
        run: runtime,
        turn: "",
        frame: {
          type: "control_request",
          request_id: "approval-1",
          request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "bun test" } },
        },
      }),
    ).toMatchObject([{ type: "request", key: "approval-1", title: "Bash", supported: true }])
    expect(
      adapter.events({
        run: runtime,
        turn: "",
        inputID: "prompt-1",
        frame: {
          type: "result",
          uuid: "result-1",
          session_id: "native-session",
          is_error: false,
          usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 80 },
          total_cost_usd: 0.002,
          modelUsage: { opus: { inputTokens: 20, outputTokens: 30, cacheReadInputTokens: 80 } },
        },
      }),
    ).toMatchObject([
      {
        type: "completed",
        outcome: "completed",
        nativeID: "native-session",
        metrics: [
          { identity: "result:result-1", model: "opus", status: "succeeded" },
          { cost: 0.002, model: "opus", pricing: "estimated", status: "idle" },
        ],
      },
    ])
  })
})

describe("agent runtime supervisor", () => {
  test("fans out a reusable runtime and fences a later generation", async () => {
    await using tmp = await tmpdir("redcode-agent-runtime-")
    const supervisor = createAgentRuntimeSupervisor()
    const fixture = path.resolve(import.meta.dir, "fixture/harness-process.ts")
    const args = [fixture, "codex", path.join(tmp.path, "wire.jsonl"), "app-server"]
    const frames = { first: [] as string[], second: [] as string[] }
    const first = supervisor.acquire({
      key: "codex:default",
      owner: "first",
      reusable: true,
      executable: process.execPath,
      args,
      directory: tmp.path,
      subscriber: { frame: (value) => frames.first.push(String(value.method)), exit: () => {} },
    })
    const second = supervisor.acquire({
      key: "codex:default",
      owner: "second",
      reusable: true,
      executable: process.execPath,
      args,
      directory: tmp.path,
      subscriber: { frame: (value) => frames.second.push(String(value.method)), exit: () => {} },
    })
    expect(first.created).toBeTrue()
    expect(second.created).toBeFalse()
    expect(second.generation).toBe(first.generation)
    expect(second.wire.pid).toBe(first.wire.pid)
    const initialized = { count: 0 }
    await Promise.all([
      first.initialize(async () => {
        initialized.count++
        await first.wire.request("initialize", {}, "codex")
      }),
      second.initialize(async () => {
        initialized.count++
        await second.wire.request("initialize", {}, "codex")
      }),
    ])
    expect(initialized.count).toBe(1)
    const opened = await first.wire.request("thread/start", {}, "codex")
    await first.wire.request(
      "turn/start",
      { threadId: (opened.thread as { id: string }).id, input: [{ type: "text", text: "hello" }] },
      "codex",
    )
    await until(
      () => frames.first.includes("turn/completed") && frames.second.includes("turn/completed"),
      () => JSON.stringify(frames),
    )
    await first.release()
    expect(supervisor.snapshot()[0]?.owners).toEqual(["second"])
    await second.release()
    expect(supervisor.snapshot()).toEqual([])

    const third = supervisor.acquire({
      key: "codex:default",
      owner: "third",
      reusable: true,
      executable: process.execPath,
      args,
      directory: tmp.path,
      subscriber: { frame: () => {}, exit: () => {} },
    })
    expect(third.created).toBeTrue()
    expect(third.generation).not.toBe(first.generation)
    await supervisor.dispose()
  }, 15_000)

  test("keeps an unowned runtime warm, reuses it and reaps it after its idle timeout", async () => {
    await using tmp = await tmpdir("redcode-agent-runtime-idle-")
    const supervisor = createAgentRuntimeSupervisor()
    const input = {
      key: "codex:warm",
      reusable: true,
      executable: process.execPath,
      args: [path.resolve(import.meta.dir, "fixture/harness-process.ts"), "codex", path.join(tmp.path, "wire.jsonl")],
      directory: tmp.path,
      idleTimeoutMs: 100,
    }
    const first = supervisor.acquire({
      ...input,
      owner: "first",
      subscriber: { frame: () => {}, exit: () => {} },
    })
    await first.initialize(() => first.wire.request("initialize", {}, "codex").then(() => {}))
    await first.release()
    expect(supervisor.snapshot()[0]).toMatchObject({ owners: [], pid: first.wire.pid })
    expect(supervisor.snapshot()[0]?.idleUntil).toBeGreaterThan(Date.now())

    const second = supervisor.acquire({
      ...input,
      owner: "second",
      subscriber: { frame: () => {}, exit: () => {} },
    })
    expect(second.created).toBeFalse()
    expect(second.generation).toBe(first.generation)
    expect(second.wire.pid).toBe(first.wire.pid)
    await second.release()
    await until(() => supervisor.snapshot().length === 0, () => JSON.stringify(supervisor.snapshot()))
    await supervisor.dispose()
  })
})

async function until(check: () => boolean, detail: () => string) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Runtime event did not arrive: ${detail()}`)
    await Bun.sleep(10)
  }
}

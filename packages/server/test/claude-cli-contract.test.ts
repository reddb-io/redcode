import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { AbsolutePath } from "@opencode/schema/schema"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { createHarnesses } from "../src/harness"
import { ClaudeRuntimeProtocol } from "../src/agent-runtime/adapters/claude"

// Runs Redcode's harness against an installed Claude Code CLI to catch protocol changes in new releases.
// The CLI talks to a local stub API with a placeholder key, so no account or model request is involved.
// Run with REDCODE_CLAUDE_CLI=claude from packages/server, or through the Claude CLI contract workflow.
const cli = process.env.REDCODE_CLAUDE_CLI

type Captured = {
  system: string
  thinking?: { display?: string }
  effort?: string
  messages: number
  steered: boolean
}

const REASONING = "Contract reasoning step."
const REPLY = "contract-ok"
const STEER_SCENARIO = "CONTRACT_STEER_SCENARIO"
const STEER_TEXT = "CONTRACT_STEER_TEXT"
const captured: Captured[] = []
const saved: Record<string, string | undefined> = {}
let server: ReturnType<typeof Bun.serve> | undefined

function sse(event: string, data: object) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function reply(model: string) {
  const message = {
    id: `msg_contract_${captured.length}`,
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  return [
    sse("message_start", { type: "message_start", message }),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: REASONING },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "s" },
    }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "contract-" },
    }),
    sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "ok" } }),
    sse("content_block_stop", { type: "content_block_stop", index: 1 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 2 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("")
}

// A Bash call needs approval, which holds the turn open long enough to steer it deterministically.
function toolCall(model: string) {
  const message = {
    id: `msg_contract_${captured.length}`,
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  return [
    sse("message_start", { type: "message_start", message }),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_contract", name: "Bash", input: {} },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: "mkdir contract-steer" }) },
    }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("")
}

async function until(check: () => boolean, timeout = 60_000) {
  const end = Date.now() + timeout
  while (!check()) {
    if (Date.now() > end) throw new Error("The Claude CLI did not settle")
    await Bun.sleep(50)
  }
}

describe.skipIf(!cli)("Claude Code CLI contract", () => {
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (!url.pathname.startsWith("/v1/messages") || url.pathname.includes("count_tokens"))
          return Response.json({ input_tokens: 1 })
        const body = await request.json()
        const history = JSON.stringify(body.messages)
        // The main loop carries the tool list; side requests such as titles do not.
        if (body.tools?.length)
          captured.push({
            system: (Array.isArray(body.system) ? body.system : [{ text: body.system ?? "" }])
              .map((block: { text?: string }) => block.text ?? "")
              .join("\n"),
            thinking: body.thinking,
            effort: body.output_config?.effort,
            messages: body.messages.length,
            steered: history.includes(STEER_TEXT),
          })
        const callTool = body.tools?.length && history.includes(STEER_SCENARIO) && !history.includes("tool_result")
        return new Response(callTool ? toolCall(body.model) : reply(body.model), {
          headers: { "content-type": "text/event-stream" },
        })
      },
    })
    const variables = {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
      ANTHROPIC_API_KEY: "sk-ant-api03-local-contract-placeholder",
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    }
    for (const [name, value] of Object.entries(variables)) {
      saved[name] = process.env[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  afterAll(() => {
    server?.stop(true)
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test("check, run, stream, reason and fork through the installed CLI", async () => {
    await using tmp = await tmpdir("redcode-claude-contract-")
    const home = path.join(tmp.path, "claude-home")
    const checkout = path.join(tmp.path, "checkout")
    await Bun.write(path.join(home, ".keep"), "")
    await Bun.write(path.join(checkout, "README.md"), "contract\n")
    const service = await createHarnesses(path.join(tmp.path, "state"))
    try {
      const provider = await service.configure({ driver: "claude", executable: cli!, home: AbsolutePath.make(home) })
      expect(provider).toMatchObject({ installed: true, authenticated: true, account: { method: "api_key" } })
      expect(provider.version?.match(/\d+\.\d+\.\d+/)?.[0]).toBeDefined()
      expect(
        Bun.semver.order(provider.version!.match(/\d+\.\d+\.\d+/)![0], ClaudeRuntimeProtocol.minimumVersion),
      ).toBeGreaterThanOrEqual(0)
      expect(provider.detail).toBeUndefined()
      expect(provider.models?.length).toBeGreaterThan(0)

      const run = await service.open({
        driver: "claude",
        directory: AbsolutePath.make(checkout),
        backgroundWait: true,
        effort: "high",
        permissionMode: "acceptEdits",
      })
      await service.prompt(run.id, { id: "contract-first", text: "Say ok.", delivery: "queue" })
      await until(() => service.read(run.id).run.state === "ready")
      const first = captured.at(-1)!
      // Redcode appends its tool guidance; Claude Code's own prompt stays in place.
      expect(first.system).toContain("Redcode hosts this session")
      expect(first.system.length).toBeGreaterThan(2000)
      expect(first.thinking?.display).toBe("summarized")
      expect(first.effort).toBe("high")
      const events = service.read(run.id).events
      expect(
        events
          .filter((event) => event.kind === "text")
          .map((event) => event.text)
          .join(""),
      ).toBe(REPLY)
      expect(events.filter((event) => event.kind === "reasoning").map((event) => event.text)).toEqual([REASONING])
      const source = service.read(run.id).run.nativeID
      expect(source).toBeDefined()

      const fork = await service.fork(run.id)
      await service.prompt(fork.id, { id: "contract-fork", text: "Say ok again.", delivery: "queue" })
      await until(() => service.read(fork.id).run.state === "ready")
      expect(service.read(fork.id).run).toMatchObject({ fork: false })
      expect(service.read(fork.id).run.nativeID).not.toBe(source)
      // The fork carries the original conversation.
      expect(captured.at(-1)!.messages).toBeGreaterThan(first.messages)

      // A steer sent while the turn waits for approval reaches Claude within that same turn.
      const steering = await service.open({ driver: "claude", directory: AbsolutePath.make(checkout) })
      await service.prompt(steering.id, { id: "contract-steer-start", text: STEER_SCENARIO, delivery: "queue" })
      await until(() => service.read(steering.id).requests.length === 1)
      const before = captured.length
      await service.prompt(steering.id, { id: "contract-steer", text: STEER_TEXT, delivery: "steer" })
      service.answer(steering.id, { request: service.read(steering.id).requests[0]!.id, allow: true, answers: {} })
      await until(() => service.read(steering.id).run.state === "ready")
      expect(captured.slice(before).some((request) => request.steered)).toBe(true)
    } finally {
      await service.dispose()
    }
  }, 180_000)
})

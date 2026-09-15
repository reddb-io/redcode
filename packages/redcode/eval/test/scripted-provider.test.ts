import { describe, expect, test } from "bun:test"
import { ScriptedProvider } from "../lib/scripted-provider"

const post = (url: string, body: unknown) =>
  fetch(`${url}/chat/completions`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })

describe("scripted provider", () => {
  test("templates resolve at request time and whole-number templates stay numbers", async () => {
    const values: Record<string, string> = { workspace: "/tmp/w", "todo.0.revision": "3" }
    expect(await ScriptedProvider.template("{{workspace}}/a.ts and {{workspace}}", (key) => values[key]!)).toBe("/tmp/w/a.ts and /tmp/w")
    const provider = ScriptedProvider.start({
      cassette: {
        version: 1,
        name: "t",
        source: "test",
        steps: [{ tools: [{ name: "todowrite", input: { revision: "{{todo.0.revision}}", path: "{{workspace}}/x" } }], usage: { input: 1, output: 1 } }],
      },
      resolve: (key) => values[key]!,
    })
    try {
      const text = await (await post(provider.url, { messages: [] })).text()
      expect(text).toContain(JSON.stringify(JSON.stringify({ revision: 3, path: "/tmp/w/x" })).slice(1, -1))
      expect(text).toContain('"finish_reason":"tool_calls"')
    } finally {
      provider.stop()
    }
  })

  test("steps are consumed in order, match-gated steps wait, titles are free and running out is recorded", async () => {
    const provider = ScriptedProvider.start({
      cassette: {
        version: 1,
        name: "t",
        source: "test",
        steps: [
          { match: "A monitor finished.", text: "resumed", usage: { input: 3, output: 1 } },
          { text: "first", usage: { input: 2, output: 1 } },
        ],
      },
      resolve: () => "",
    })
    try {
      const title = await (await post(provider.url, { messages: [{ content: "Generate a title for this conversation" }] })).text()
      expect(title).toContain("Eval run")
      const first = await (await post(provider.url, { messages: [{ content: "hi" }], tools: [{ function: { name: "bash" } }] })).text()
      expect(first).toContain('"content":"first"')
      expect(first).toContain('"prompt_tokens":2')
      const miss = await post(provider.url, { messages: [{ content: "again" }] })
      expect(miss.status).toBe(400)
      expect(provider.exhausted()).toContain("no step for request 3")
      const resumed = await (await post(provider.url, { messages: [{ content: "A monitor finished. ok" }] })).text()
      expect(resumed).toContain("resumed")
      expect(provider.pending()).toBe(0)
      expect(provider.requests().map((item) => item.kind)).toEqual(["title", "step", "miss", "step"])
      expect(provider.requests()[1]!.tools).toEqual(["bash"])
      expect(provider.exchanges()).toHaveLength(2)
    } finally {
      provider.stop()
    }
  })

  test("a step without usage streams no usage, as a model that stops does", () => {
    const text = ScriptedProvider.sse({ text: "hi" })
    expect(text).not.toContain("usage")
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true)
  })

  test("a live transcript becomes a replayable cassette", () => {
    const cassette = ScriptedProvider.fromMessages("edit.openrouter-qwen", "openrouter/qwen/qwen3", [
      { info: { role: "user" }, parts: [{ type: "text", text: "go" }] },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "Looking." },
          { type: "tool", tool: "read", state: { input: { filePath: "/w/a" } } },
          { type: "step-finish", tokens: { input: 900, output: 12 } },
        ],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Done." }] },
    ])
    expect(cassette).toEqual({
      version: 1,
      name: "edit.openrouter-qwen",
      source: "openrouter/qwen/qwen3",
      steps: [
        { text: "Looking.", tools: [{ name: "read", input: { filePath: "/w/a" } }], usage: { input: 900, output: 12 } },
        { text: "Done." },
      ],
    })
  })
})

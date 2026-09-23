import { describe, expect, test } from "bun:test"
import { GenerationOptions, HttpOptions, LLM, LLMRequest, Message, Model, ToolDefinition } from "@reddb-io/redcode-llm"
import { OpenAIChat } from "@reddb-io/redcode-llm/protocols/openai-chat"
import { PromptCacheDiagnostics } from "@reddb-io/redcode-core/session/prompt-cache-diagnostics"

const model = Model.make({ id: "test", provider: "test", route: OpenAIChat.route })
const tool = ToolDefinition.make({
  name: "read",
  description: "Read a file",
  inputSchema: { type: "object", properties: {} },
})

const request = LLM.request({
  model,
  system: "System",
  prompt: "First",
  tools: [tool],
})
const snapshot = (current: LLMRequest) => PromptCacheDiagnostics.snapshot(PromptCacheDiagnostics.fromRequest(current))
const compare = (current: LLMRequest) => PromptCacheDiagnostics.compare(snapshot(request), snapshot(current))

describe("PromptCacheDiagnostics", () => {
  test("distinguishes initial and stable requests", () => {
    expect(PromptCacheDiagnostics.compare(undefined, snapshot(request))).toEqual({ status: "initial" })
    expect(compare(request)).toEqual({ status: "stable", messages: 1 })
  })

  test("recognizes append-only history", () => {
    const current = LLMRequest.update(request, { messages: [...request.messages, Message.assistant("Second")] })
    expect(compare(current)).toEqual({ status: "append-only", previousMessages: 1, currentMessages: 2 })
  })

  test("detects cache-sensitive setting changes", () => {
    const current = LLMRequest.update(request, { generation: GenerationOptions.make({ temperature: 0.5 }) })
    expect(compare(current)).toEqual({ status: "changed", component: "settings", index: 0, label: "model settings" })
  })

  test("ignores request headers, which carry per-turn routing hints", () => {
    const current = LLMRequest.update(request, {
      http: HttpOptions.make({ headers: { "x-red-router-hint": "tier=high" } }),
    })
    expect(compare(current)).toEqual({ status: "stable", messages: 1 })
  })

  test("finds the first changed prefix component", () => {
    const changedTool = ToolDefinition.make({ ...tool, description: "Read one file" })
    const current = LLMRequest.update(request, { tools: [changedTool] })
    expect(compare(current)).toEqual({ status: "changed", component: "tools", index: 0, label: "read" })
  })

  test("treats appended tools as a prefix change", () => {
    const write = ToolDefinition.make({
      name: "write",
      description: "Write a file",
      inputSchema: { type: "object", properties: {} },
    })
    const current = LLMRequest.update(request, { tools: [...request.tools, write] })
    expect(compare(current)).toEqual({ status: "changed", component: "tools", index: 1, label: "write" })
  })

  test("reports a rewritten earlier message rather than an append", () => {
    const current = LLMRequest.update(request, { messages: [Message.user("Edited"), Message.assistant("Second")] })
    expect(compare(current)).toEqual({ status: "changed", component: "messages", index: 0, label: "user[0]" })
  })

  test("hashes binary payloads by content", () => {
    const components = (bytes: Uint8Array) => ({
      settings: {},
      tools: [],
      system: [],
      messages: [{ label: "user[0]", value: { image: bytes } }],
    })
    const first = PromptCacheDiagnostics.snapshot(components(new Uint8Array([1, 2, 3])))
    expect(
      PromptCacheDiagnostics.compare(first, PromptCacheDiagnostics.snapshot(components(Buffer.from([1, 2, 3])))),
    ).toEqual({ status: "stable", messages: 1 })
    expect(
      PromptCacheDiagnostics.compare(first, PromptCacheDiagnostics.snapshot(components(new Uint8Array([1, 2, 4])))),
    ).toMatchObject({ status: "changed", component: "messages", index: 0 })
  })

  test("classifies each comparison for a one-word log field", () => {
    expect(PromptCacheDiagnostics.classify({ status: "initial" })).toBe("initial")
    expect(PromptCacheDiagnostics.classify({ status: "stable", messages: 1 })).toBe("stable")
    expect(PromptCacheDiagnostics.classify({ status: "append-only", previousMessages: 1, currentMessages: 2 })).toBe(
      "append-only",
    )
    expect(
      PromptCacheDiagnostics.classify({ status: "changed", component: "system", index: 0, label: "system[0]" }),
    ).toBe("changed:system")
  })

  test("tracks each session separately and forgets the least recently used one", () => {
    const observe = PromptCacheDiagnostics.tracker(2)
    const components = PromptCacheDiagnostics.fromRequest(request)
    const appended = PromptCacheDiagnostics.fromRequest(
      LLMRequest.update(request, { messages: [...request.messages, Message.assistant("Second")] }),
    )

    expect(observe("a", components)).toMatchObject({ cache: "initial", tools: 1, systemParts: 1, messages: 1 })
    expect(observe("b", components).cache).toBe("initial")
    expect(observe("a", appended)).toMatchObject({ cache: "append-only", previousMessages: 1, messages: 2 })
    // "b" is now the least recently used session, so a third one evicts it.
    expect(observe("c", components).cache).toBe("initial")
    expect(observe("a", appended).cache).toBe("stable")
    expect(observe("b", components).cache).toBe("initial")
  })
})

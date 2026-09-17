import { describe, expect, test } from "bun:test"
import type { Message } from "@reddb-io/redcode-sdk/v2/client"
import { formatLatency, formatSpeed, getSessionContext } from "./session-context-metrics"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time: { created: 1 },
  } as unknown as Message
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

describe("getSessionContext", () => {
  test("computes token totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 600, output: 200, reasoning: 100, read: 50, write: 50 }, 0.5),
      assistant("a2", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1000 },
          },
        },
      },
    ]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.message.id).toBe("a2")
    expect(ctx?.total).toBe(500)
    expect(ctx?.input).toBe(300)
    expect(ctx?.usage).toBe(50)
    expect(ctx?.providerLabel).toBe("OpenAI")
    expect(ctx?.modelLabel).toBe("GPT-4.1")
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.providerLabel).toBe("p-1")
    expect(ctx?.modelLabel).toBe("m-1")
    expect(ctx?.limit).toBeUndefined()
    expect(ctx?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContext(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContext(messages, providers)

    expect(one?.message.id).toBe("a1")
    expect(two?.message.id).toBe("a2")
  })

  test("returns undefined when inputs are undefined", () => {
    const ctx = getSessionContext(undefined, undefined)

    expect(ctx).toBeUndefined()
  })
})

describe("latency and output speed", () => {
  const timed = (input: Record<string, unknown>) =>
    ({
      ...(assistant("timed", { input: 10, output: 200, reasoning: 100, read: 0, write: 0 }, 0) as object),
      parentID: "u1",
      time: { created: 1_000, completed: 60_000 },
      ...input,
    }) as unknown as Message

  test("reads the measured step: latency to first token and tokens over the generation window", () => {
    const ctx = getSessionContext([timed({ timing: { firstToken: 1_800, ttftMs: 800, tokens: 300, genMs: 3_000 } })])
    expect(ctx?.meter?.step.latency).toBe(800)
    // 300 tokens over the 3 s window, not over the 59 s the step took with its tool run.
    expect(ctx?.meter?.step.speed).toEqual({ type: "rate", value: 100 })
    expect(ctx?.meter?.step.stale).toBe(true)
  })

  test("a message recorded before timing existed shows nothing", () => {
    const ctx = getSessionContext([timed({ time: { created: 1_000, first: 1_800, completed: 60_000 } })])
    expect(ctx?.message.id).toBe("timed")
    expect(ctx?.meter).toBeUndefined()
  })

  test("a compaction summary after the step does not replace its numbers", () => {
    const summary = {
      ...(timed({ timing: { replayed: true } }) as object),
      id: "summary",
      summary: true,
    } as unknown as Message
    const ctx = getSessionContext([
      timed({ timing: { firstToken: 1_800, ttftMs: 800, tokens: 300, genMs: 3_000 } }),
      summary,
    ])
    expect(ctx?.meter?.step.message.id).toBe("timed")
  })

  test("formats for the panel in the reader's locale", () => {
    expect(formatLatency(420, "en-US")).toBe("420ms")
    expect(formatLatency(1_850, "en-US")).toBe("1.9s")
    expect(formatLatency(undefined, "en-US")).toBe("—")
    expect(formatSpeed({ type: "rate", value: 7.25 }, "en-US", "Burst")).toBe("7.3 tk/s")
    expect(formatSpeed({ type: "rate", value: 1_234.6 }, "de-DE", "Burst")).toBe("1.235 tk/s")
    expect(formatSpeed({ type: "burst" }, "en-US", "Burst")).toBe("Burst")
    expect(formatSpeed({ type: "short" }, "en-US", "Burst")).toBe("—")
    expect(formatSpeed(undefined, "en-US", "Burst")).toBe("—")
  })
})

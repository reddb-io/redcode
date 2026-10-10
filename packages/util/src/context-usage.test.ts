import { describe, expect, test } from "bun:test"
import { ContextUsage } from "./context-usage.js"

type Message =
  | {
      id: string
      type: "assistant"
      model: { providerID: string; id: string }
      tokens?: ContextUsage.Tokens
    }
  | { id: string; type: "compaction"; status: "running" | "completed" }
  | { id: string; type: "user" }

const assistant = (id: string, input: number): Message => ({
  id,
  type: "assistant",
  model: { id: "model", providerID: "provider" },
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const window = (context: number) => (model: ContextUsage.ModelRef) =>
  model.providerID === "provider" && model.id === "model" ? context : undefined

describe("ContextUsage", () => {
  test("tracks usage across undo and redo boundaries", () => {
    const messages = [assistant("msg_z", 10), assistant("msg_a", 30)]

    expect(ContextUsage.lastMeasured(messages)?.tokens.input).toBe(30)
    expect(ContextUsage.lastMeasured(messages, "msg_a")?.tokens.input).toBe(10)
    expect(ContextUsage.lastMeasured(messages, "msg_missing")).toBeUndefined()
  })

  test("resets usage at completed compaction until the next assistant reports it", () => {
    const messages: Message[] = [
      assistant("msg_before", 30),
      { id: "msg_running", type: "compaction", status: "running" },
    ]

    // A compaction still running has not replaced the window.
    expect(ContextUsage.lastMeasured(messages)?.id).toBe("msg_before")

    messages.push({ id: "msg_compaction", type: "compaction", status: "completed" })
    expect(ContextUsage.lastMeasured(messages)).toBeUndefined()

    messages.push(
      { id: "msg_user", type: "user" },
      { id: "msg_unmeasured", type: "assistant", model: { id: "model", providerID: "provider" } },
    )
    expect(ContextUsage.lastMeasured(messages)).toBeUndefined()

    messages.push(assistant("msg_after", 5))
    expect(ContextUsage.lastMeasured(messages)?.tokens.input).toBe(5)
  })

  test("reports the window the percentage is of", () => {
    const messages = [assistant("msg_a", 321_000)]

    expect(ContextUsage.read(messages, window(115_200))).toMatchObject({
      tokens: 321_000,
      limit: 115_200,
      percent: 279,
    })
    // A model entry without a window gives neither a percentage nor a window.
    expect(ContextUsage.read(messages, window(0))).toMatchObject({
      tokens: 321_000,
      limit: undefined,
      percent: undefined,
    })
    expect(ContextUsage.read(messages, () => undefined)).toMatchObject({ tokens: 321_000, percent: undefined })
    expect(ContextUsage.read([assistant("msg_empty", 0)], window(1_000))).toBeUndefined()
  })

  test("is over only past the window", () => {
    expect(ContextUsage.over({ percent: 101 })).toBe(true)
    expect(ContextUsage.over({ percent: 100 })).toBe(false)
    expect(ContextUsage.over({ percent: undefined })).toBe(false)
  })

  test("formats the usage against its window with the surface's number style", () => {
    const number = (value: number) => value.toLocaleString("en-US")

    expect(ContextUsage.format({ tokens: 321_000, limit: 115_200, percent: 279 }, number)).toBe(
      "321,000 / 115,200 (279%)",
    )
    expect(ContextUsage.format({ tokens: 14_100, percent: 1 }, number)).toBe("14,100 (1%)")
    expect(ContextUsage.format({ tokens: 14_100 }, number)).toBe("14,100")
  })
})

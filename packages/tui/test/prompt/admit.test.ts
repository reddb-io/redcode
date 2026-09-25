import { describe, expect, test } from "bun:test"
import { admitPrompt, transient, type AdmitResponse } from "../../src/prompt/admit"

// A scripted server: each send takes the next answer, and every message ID it was sent is kept.
function server(answers: Array<AdmitResponse | Error>) {
  const ids: string[] = []
  const slept: number[] = []
  return {
    ids,
    slept,
    send: async (messageID: string) => {
      ids.push(messageID)
      const answer = answers[ids.length - 1] ?? {}
      if (answer instanceof Error) throw answer
      return answer
    },
    sleep: async (ms: number) => {
      slept.push(ms)
    },
  }
}

const unavailable = { error: { message: "unavailable" }, response: { status: 503 } }

describe("admitPrompt", () => {
  test("names a new message ID and is done once the server admits it", async () => {
    const fake = server([{}])
    const outcome = await admitPrompt({ send: fake.send, sleep: fake.sleep })
    expect(outcome.ok).toBe(true)
    expect(fake.ids).toHaveLength(1)
    expect(fake.ids[0]).toStartWith("msg_")
    expect(outcome.messageID).toBe(fake.ids[0]!)
    expect(fake.slept).toEqual([])
  })

  test("each submit names its own message ID", async () => {
    const first = await admitPrompt({ send: server([{}]).send })
    const second = await admitPrompt({ send: server([{}]).send })
    expect(first.messageID).not.toBe(second.messageID)
  })

  test("a transient failure is retried with the same message ID, so the server admits one prompt", async () => {
    const fake = server([new TypeError("fetch failed"), unavailable, {}])
    const outcome = await admitPrompt({ send: fake.send, sleep: fake.sleep, delays: [1, 2, 3] })
    expect(outcome.ok).toBe(true)
    expect(fake.ids).toHaveLength(3)
    expect(new Set(fake.ids).size).toBe(1)
    expect(fake.slept).toEqual([1, 2])
  })

  test("a refusal is final at once and reported", async () => {
    const refused = { error: { name: "BadRequest" }, response: { status: 400 } }
    const fake = server([refused, {}])
    const outcome = await admitPrompt({ send: fake.send, sleep: fake.sleep, delays: [1, 2, 3] })
    expect(outcome).toEqual({ ok: false, messageID: fake.ids[0]!, error: refused.error })
    expect(fake.ids).toHaveLength(1)
  })

  test("gives up after the last retry, having only ever sent one message ID", async () => {
    const fake = server([unavailable, unavailable, unavailable, unavailable, {}])
    const outcome = await admitPrompt({ send: fake.send, sleep: fake.sleep, delays: [1, 2, 3] })
    expect(outcome.ok).toBe(false)
    expect(fake.ids).toHaveLength(4)
    expect(new Set(fake.ids).size).toBe(1)
    expect(fake.slept).toEqual([1, 2, 3])
  })
})

describe("transient", () => {
  test("no response, a timeout, rate limiting and server errors may pass on a retry", () => {
    expect(transient({ error: new TypeError("fetch failed") })).toBe(true)
    expect(transient({ error: {}, response: { status: 408 } })).toBe(true)
    expect(transient({ error: {}, response: { status: 429 } })).toBe(true)
    expect(transient({ error: {}, response: { status: 502 } })).toBe(true)
  })

  test("a request the server refused fails the same way again", () => {
    expect(transient({ error: {}, response: { status: 400 } })).toBe(false)
    expect(transient({ error: {}, response: { status: 404 } })).toBe(false)
  })
})

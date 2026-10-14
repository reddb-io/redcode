import { describe, expect, test } from "bun:test"
import { terminalWriter } from "./writer"

describe("terminalWriter", () => {
  test("bounds pending terminal output while rendering is blocked and accepts it again after draining", () => {
    const completions: VoidFunction[] = []
    const scheduled: VoidFunction[] = []
    const events: string[] = []
    const writer = terminalWriter(
      (data, done) => {
        events.push(data)
        if (done) completions.push(done)
      },
      (flush) => scheduled.push(flush),
    )
    writer.push("first")
    scheduled.shift()?.()
    const chunk = "x".repeat(1024 * 1024)
    let accepted = 0
    while (accepted < 16 && writer.push(chunk) !== false) accepted++
    expect(accepted).toBeLessThanOrEqual(4)
    expect(writer.push(chunk)).toBeFalse()
    completions.shift()?.()
    scheduled.shift()?.()
    completions.shift()?.()
    expect(events.join("")).toBe("first" + chunk.repeat(accepted))
    expect(writer.push("resumed")).toBeTrue()
    scheduled.shift()?.()
    completions.shift()?.()
    expect(events.at(-1)).toBe("resumed")
  })

  test("final flush preserves output queued behind an in-flight write", () => {
    const scheduled: VoidFunction[] = []
    const completions: VoidFunction[] = []
    const events: string[] = []

    const writer = terminalWriter(
      (data, done) => {
        events.push(data)

        if (done) completions.push(done)
      },
      (flush) => scheduled.push(flush),
    )

    writer.push("build started\r\n")
    scheduled.shift()?.()
    writer.push("\x1b[32mPASS\x1b[0m ")
    writer.push("session/history.test.ts\r\n")
    writer.flush(() => events.push("persist and dispose"))
    expect(events).toEqual(["build started\r\n"])
    completions.shift()?.()
    scheduled.shift()?.()
    expect(events).toEqual(["build started\r\n", "\x1b[32mPASS\x1b[0m session/history.test.ts\r\n"])
    completions.shift()?.()
    expect(events).toEqual([
      "build started\r\n",
      "\x1b[32mPASS\x1b[0m session/history.test.ts\r\n",
      "persist and dispose",
    ])
  })
})

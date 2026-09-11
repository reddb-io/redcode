import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { deadlineMs, guard, message, TOOL_DEADLINE_DEFAULT_MS } from "@/session/tool-deadline"

describe("tool deadlines", () => {
  test("bounds a tool that has no bound of its own", () => {
    expect(deadlineMs({ tool: "read" })).toBe(TOOL_DEADLINE_DEFAULT_MS)
    expect(deadlineMs({ tool: "grep" })).toBe(TOOL_DEADLINE_DEFAULT_MS)
  })

  test("leaves alone the tools that legitimately take as long as they take", () => {
    // shell carries its own deadline and the model chooses it; question waits for a person; task
    // runs a whole child turn that has its own watchdog.
    expect(deadlineMs({ tool: "shell" })).toBeUndefined()
    expect(deadlineMs({ tool: "question" })).toBeUndefined()
    expect(deadlineMs({ tool: "task" })).toBeUndefined()
  })

  test("configuration overrides the default, and false turns it off", () => {
    expect(deadlineMs({ tool: "read", configured: 5_000 })).toBe(5_000)
    expect(deadlineMs({ tool: "read", configured: false })).toBeUndefined()
    expect(deadlineMs({ tool: "read", configured: 0 })).toBeUndefined()
  })

  test("the failure tells the model what happened and what to do", () => {
    const text = message({ tool: "read", ms: 600_000 })
    expect(text).toContain("read")
    expect(text).toContain("10m")
    expect(text).toContain("try a different approach")
  })

  test("stops a call that outlives its deadline", async () => {
    const exit = await Effect.runPromiseExit(guard(() => Effect.never, { tool: "read", ms: 60, waitedMs: () => 0 }))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toMatch(/read tool was still running/)
  })

  test("does not charge a tool for time a person spent deciding", async () => {
    // The permission dialog left open is the case: elapsed time grows, but none of it is the
    // tool's, so the deadline must not arrive.
    const started = Date.now()
    const exit = await Effect.runPromiseExit(
      guard(() => Effect.sleep("300 millis").pipe(Effect.as("done")), {
        tool: "edit",
        ms: 60,
        waitedMs: () => Date.now() - started,
      }),
    )
    expect(exit).toEqual(Exit.succeed("done"))
  })

  test("aborts the tool it stops, so one that honours ctx.abort actually ends", async () => {
    // The tool runs as a promise in its own root fiber, so interrupting the race cannot reach it.
    // The only thing that can is the signal it was handed. A fake tool that settles only when that
    // signal fires stands in for edit, webfetch, or an LSP request left waiting on a dead peer.
    const turn = new AbortController()
    let seen: AbortSignal | undefined
    let settled: Promise<string> | undefined
    const exit = await Effect.runPromiseExit(
      guard(
        (abort) => {
          seen = abort
          settled = new Promise<string>((resolve) =>
            abort.addEventListener("abort", () => resolve("tool observed abort"), { once: true }),
          )
          return Effect.promise(() => settled!)
        },
        { tool: "edit", ms: 60, waitedMs: () => 0, abort: turn.signal },
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toMatch(/edit tool was still running/)
    expect(seen?.aborted).toBe(true)
    expect(await settled).toBe("tool observed abort")
    // The deadline stops this one call, not the turn that made it.
    expect(turn.signal.aborted).toBe(false)
  })

  test("the tool still sees the turn being aborted", async () => {
    const turn = new AbortController()
    let seen: AbortSignal | undefined
    const running = Effect.runPromiseExit(
      guard(
        (abort) => {
          seen = abort
          return Effect.never
        },
        { tool: "edit", ms: 10_000, waitedMs: () => 0, abort: turn.signal },
      ),
    )
    await Effect.runPromise(Effect.sleep("20 millis"))
    turn.abort(new Error("user stopped the turn"))
    expect(seen?.aborted).toBe(true)
    expect(seen?.reason).toBeInstanceOf(Error)
    // The guard itself stays out of it: the caller owns what an aborted turn means.
    const exit = await Promise.race([running, Effect.runPromise(Effect.sleep("50 millis").pipe(Effect.as("pending")))])
    expect(exit).toBe("pending")
  })

  test("a call that finishes in time is never aborted", async () => {
    let seen: AbortSignal | undefined
    const exit = await Effect.runPromiseExit(
      guard(
        (abort) => {
          seen = abort
          return Effect.succeed("done")
        },
        { tool: "read", ms: 60, waitedMs: () => 0 },
      ),
    )
    expect(exit).toEqual(Exit.succeed("done"))
    await Effect.runPromise(Effect.sleep("100 millis"))
    expect(seen?.aborted).toBe(false)
  })
})

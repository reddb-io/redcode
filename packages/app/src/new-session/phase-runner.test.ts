import { describe, expect, test } from "bun:test"
import {
  createNewSessionPhaseRunner,
  createPhaseState,
  NewSessionPhaseTimeoutError,
  transitionPhase,
} from "./phase-runner"

describe("new session phase lifecycle", () => {
  test("fences stale phase results", () => {
    const started = transitionPhase(createPhaseState(), { type: "phase.started", phase: "mcp" })
    const stale = transitionPhase(started, { type: "phase.settled", attempt: 0, phase: "mcp" })
    const wrongPhase = transitionPhase(started, { type: "phase.settled", attempt: 1, phase: "session" })
    const settled = transitionPhase(started, { type: "phase.settled", attempt: 1, phase: "mcp" })

    expect(stale).toBe(started)
    expect(wrongPhase).toBe(started)
    expect(settled).toEqual({ status: "idle", issued: 1 })
  })

  test("times out, allows the next phase and routes a late success to cleanup", async () => {
    const runner = createNewSessionPhaseRunner()
    const first = Promise.withResolvers<string>()
    const late = Promise.withResolvers<string>()
    const timed = runner.run("session", first.promise, 5, late.resolve)

    await expect(timed).rejects.toBeInstanceOf(NewSessionPhaseTimeoutError)
    expect(runner.state()).toEqual({ status: "idle", issued: 1 })

    await expect(runner.run("mcp", Promise.resolve("ready"), 100)).resolves.toBe("ready")
    first.resolve("created")
    expect(await late.promise).toBe("created")
  })
})

import { describe, expect, test } from "bun:test"
import { CEILING, decide, limits } from "@/session/step-budget"

describe("step budget", () => {
  const bounds = limits()

  test("stays out of the way for the length of any real turn", () => {
    expect(decide({ step: 1, limits: bounds }).type).toBe("run")
    expect(decide({ step: 100, limits: bounds }).type).toBe("run")
  })

  test("asks for a report before the wall, not at it", () => {
    // The step before the cliff is the last chance to keep the work that was done.
    const decision = decide({ step: CEILING - 1, limits: bounds })
    expect(decision.type).toBe("wrap-up")
    if (decision.type !== "wrap-up") return
    expect(decision.remaining).toBe(1)
  })

  test("still stops a model that will not yield", () => {
    const decision = decide({ step: CEILING, limits: bounds })
    expect(decision.type).toBe("stop")
    if (decision.type !== "stop") return
    expect(decision.message).toContain("Send another message")
  })

  test("a custom ceiling keeps its grace steps, and a tiny one does not invert", () => {
    expect(limits({ stop_at: 10 })).toEqual({ stopAt: 10, wrapUpAt: 8 })
    expect(limits({ stop_at: 1 })).toEqual({ stopAt: 1, wrapUpAt: 1 })
    expect(limits(false)).toBeUndefined()
    // A wrap-up asked for after the wall would never be asked for at all.
    expect(limits({ stop_at: 5, wrap_up_at: 9 })).toEqual({ stopAt: 5, wrapUpAt: 5 })
  })
})

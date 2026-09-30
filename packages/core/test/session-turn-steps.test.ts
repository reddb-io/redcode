import { describe, expect, test } from "bun:test"
import { stepLimit, TURN_STEPS_DEFAULT } from "../src/session/runner/max-steps"

describe("stepLimit", () => {
  test("an agent's own steps win over the turn ceiling", () => {
    expect(stepLimit(5, 50)).toBe(5)
    expect(stepLimit(5, false)).toBe(5)
  })

  test("an agent without steps is bounded by the configured turn ceiling", () => {
    expect(stepLimit(undefined, 50)).toBe(50)
  })

  test("an agent without steps falls back to the default ceiling", () => {
    expect(stepLimit(undefined, undefined)).toBe(TURN_STEPS_DEFAULT)
    expect(TURN_STEPS_DEFAULT).toBe(400)
  })

  test("false removes the ceiling", () => {
    expect(stepLimit(undefined, false)).toBeUndefined()
  })
})

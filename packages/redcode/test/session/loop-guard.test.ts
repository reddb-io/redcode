import { describe, expect, test } from "bun:test"
import { assess, LIMITS, limits, repeats, streak, type Part } from "@/session/loop-guard"

const call = (tool: string, input: unknown, output: string, status = "completed"): Part => ({
  type: "tool",
  tool,
  state: { status, input, ...(status === "error" ? { error: output } : { output }) },
})
const text = (value: string): Part => ({ type: "text", state: { status: "completed", output: value } })
const reasoning: Part = { type: "reasoning" }

describe("loop guard", () => {
  test("sees a repetition that reasoning and text are interleaved with", () => {
    // The old detector compared the last three parts, so one reasoning part between calls hid the
    // loop completely — and reasoning models emit them constantly.
    const parts = [
      call("read", { path: "/gone" }, "ENOENT"),
      reasoning,
      text("let me try that again"),
      call("read", { path: "/gone" }, "ENOENT"),
      reasoning,
    ]
    expect(streak(parts, { tool: "read", input: { path: "/gone" } })).toBe(2)
  })

  test("leaves polling alone", () => {
    // Same call, different answers: the world is moving, so this is waiting, not repeating.
    const parts = [
      call("read", { path: "/log" }, "line 1"),
      call("read", { path: "/log" }, "line 1\nline 2"),
      call("read", { path: "/log" }, "line 1\nline 2\nline 3"),
    ]
    expect(assess({ parts, next: { tool: "read", input: { path: "/log" } }, limits: LIMITS })).toEqual({ type: "ok" })
  })

  test("counts a repeated failure, not just a repeated success", () => {
    const parts = [call("edit", { file: "a" }, "not found", "error"), call("edit", { file: "a" }, "not found", "error")]
    const decision = assess({ parts, next: { tool: "edit", input: { file: "a" } }, limits: LIMITS })
    expect(decision.type).toBe("correct")
  })

  test("a different call in between is a fresh start", () => {
    const parts = [
      call("read", { path: "/a" }, "x"),
      call("read", { path: "/a" }, "x"),
      call("grep", { pattern: "y" }, "no matches"),
    ]
    expect(streak(parts, { tool: "read", input: { path: "/a" } })).toBe(0)
  })

  test("corrects first and only stops if the correction changed nothing", () => {
    const repeat = (n: number) => Array.from({ length: n }, () => call("read", { path: "/gone" }, "ENOENT"))
    const next = { tool: "read", input: { path: "/gone" } }
    expect(assess({ parts: repeat(1), next, limits: LIMITS }).type).toBe("ok")
    expect(assess({ parts: repeat(2), next, limits: LIMITS }).type).toBe("correct")
    expect(assess({ parts: repeat(4), next, limits: LIMITS }).type).toBe("stop")
  })

  test("the correction quotes the model's own arguments and the answer it keeps ignoring", () => {
    const parts = [call("read", { path: "/gone" }, "ENOENT: no such file"), call("read", { path: "/gone" }, "ENOENT: no such file")]
    const decision = assess({ parts, next: { tool: "read", input: { path: "/gone" } }, limits: LIMITS })
    expect(decision.type).toBe("correct")
    if (decision.type !== "correct") return
    expect(decision.message).toContain('"path":"/gone"')
    expect(decision.message).toContain("ENOENT: no such file")
    // Naming the ways out is what makes the notice actionable rather than a scolding.
    expect(decision.message).toMatch(/different tool|tell the user/)
  })

  test("a call this guard already refused still counts toward stopping", () => {
    // The correction is not the tool's answer, so it must not read as the world having changed —
    // otherwise the guard resets the very streak it just started and never stops anything.
    const first = call("read", { path: "/gone" }, "ENOENT")
    const next = { tool: "read", input: { path: "/gone" } }
    const corrected = assess({ parts: [first, first], next, limits: LIMITS })
    expect(corrected.type).toBe("correct")
    if (corrected.type !== "correct") return
    const refusal = call("read", { path: "/gone" }, corrected.message, "error")
    expect(streak([first, first, refusal, refusal], next)).toBe(4)
    expect(assess({ parts: [first, first, refusal, refusal], next, limits: LIMITS }).type).toBe("stop")
  })

  test("can be turned off, and nonsense thresholds turn it off rather than firing constantly", () => {
    expect(limits(false)).toBeUndefined()
    expect(limits({ correct_at: 1 })).toBeUndefined()
    expect(limits()).toEqual(LIMITS)
    // A stop threshold below the warning would abort without ever correcting.
    expect(limits({ correct_at: 4, stop_at: 2 })).toEqual({ correctAt: 4, stopAt: 4, nudgeAt: LIMITS.nudgeAt })
  })

  test("notices a call that never stops being made, even when the answer keeps changing", () => {
    // Comparing answers is what keeps polling out of trouble, and it is also the way through: an
    // answer carrying a timestamp never repeats byte for byte, so this call would otherwise run
    // forever without ever counting as repetition.
    const ticking = (n: number) => call("bash", { command: "date" }, `now is ${n}`)
    const next = { tool: "bash", input: { command: "date" } }
    const parts = Array.from({ length: LIMITS.nudgeAt - 1 }, (_, i) => ticking(i))

    // Never a repetition by the strict rule, at any point.
    expect(streak(parts, next)).toBe(1)
    const decision = assess({ parts, next, limits: LIMITS })
    expect(decision.type).toBe("correct")
    if (decision.type !== "correct") return
    expect(decision.message).toContain(`${LIMITS.nudgeAt} times in a row`)
    // It asks rather than refuses: polling looks exactly like this and is sometimes right.
    expect(decision.message).toContain("If you are waiting for something")
  })

  test("says it once, not on every call from then on", () => {
    const ticking = (n: number) => call("bash", { command: "date" }, `now is ${n}`)
    const next = { tool: "bash", input: { command: "date" } }
    const before = Array.from({ length: LIMITS.nudgeAt - 2 }, (_, i) => ticking(i))
    const after = Array.from({ length: LIMITS.nudgeAt }, (_, i) => ticking(i))
    expect(assess({ parts: before, next, limits: LIMITS }).type).toBe("ok")
    expect(assess({ parts: after, next, limits: LIMITS }).type).toBe("ok")
  })

  test("a different call in between starts the count over", () => {
    const ticking = (n: number) => call("bash", { command: "date" }, `now is ${n}`)
    const next = { tool: "bash", input: { command: "date" } }
    const parts = [
      ...Array.from({ length: LIMITS.nudgeAt }, (_, i) => ticking(i)),
      call("read", { path: "/a" }, "x"),
      ...Array.from({ length: 2 }, (_, i) => ticking(i)),
    ]
    expect(repeats(parts, next)).toBe(2)
    expect(assess({ parts, next, limits: LIMITS }).type).toBe("ok")
  })
})

import { describe, expect, test } from "bun:test"
import { assess, failures, LIMITS, limits, repeats, streak, turn, type Part } from "@/session/loop-guard"

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
    expect(assess({ parts: repeat(4), next, limits: LIMITS })).toMatchObject({
      type: "stop",
      summary: "Paused: the same `read` call repeated 5 times",
    })
  })

  test("the correction quotes the model's own arguments and the answer it keeps ignoring", () => {
    const parts = [
      call("read", { path: "/gone" }, "ENOENT: no such file"),
      call("read", { path: "/gone" }, "ENOENT: no such file"),
    ]
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
    expect(limits({ correct_at: 4, stop_at: 2 })).toEqual({
      correctAt: 4,
      stopAt: 4,
      nudgeAt: LIMITS.nudgeAt,
      failureStopAt: LIMITS.failureStopAt,
    })
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

  test("counts the same failure across drifting arguments", () => {
    // A refused todowrite gets reshuffled every time — a new explanation, another callID — so the
    // arguments never repeat, but the gate says the same thing to each of them.
    const refusal = "Completing needs a successful tool result after the request, and none exists yet."
    const parts = [
      call("todowrite", { todos: [{ id: "t", status: "completed", evidence: { callID: "a" } }] }, refusal, "error"),
      text("let me cite the other call"),
      call("todowrite", { todos: [{ id: "t", status: "completed", evidence: { callID: "b" } }] }, refusal, "error"),
    ]
    const next = { tool: "todowrite", input: { todos: [{ id: "t", status: "completed" }] } }
    expect(streak(parts, next)).toBe(0)
    expect(failures(parts, next)).toBe(2)
    expect(assess({ parts, next, limits: LIMITS }).type).toBe("correct")
    expect(assess({ parts, next, limits: LIMITS })).toMatchObject({
      message: expect.stringContaining("failed with the same error even though the arguments changed"),
    })
    // A different error, or a success, ends the run; drifting arguments alone never start one.
    expect(failures([...parts, call("todowrite", { todos: [] }, "ok")], next)).toBe(0)
    expect(failures([...parts, call("todowrite", { todos: [] }, "Unknown task t", "error")], next)).toBe(1)
    expect(failures([call("edit", { file: "a" }, "ok"), call("edit", { file: "b" }, "ok")], { tool: "edit" })).toBe(0)
  })

  test("a failure streak is only a todowrite loop, and it corrects without ever stopping", () => {
    // Three different edits that each miss their oldString are three attempts, not one repeated call.
    const miss = "Could not find oldString in the file. It must match exactly, including whitespace."
    const edits = [
      call("edit", { filePath: "a.ts", oldString: "one" }, miss, "error"),
      call("edit", { filePath: "a.ts", oldString: "two" }, miss, "error"),
      call("edit", { filePath: "a.ts", oldString: "three" }, miss, "error"),
    ]
    const edit = { tool: "edit", input: { filePath: "a.ts", oldString: "four" } }
    expect(failures(edits, edit)).toBe(0)
    expect(assess({ parts: edits, next: edit, limits: LIMITS })).toEqual({ type: "ok" })
    // However long the todowrite refusals run with drifting arguments, the guard only corrects.
    const refusal = "Completion evidence refused: no verification result exists."
    const todos = Array.from({ length: LIMITS.stopAt + 2 }, (_, i) =>
      call("todowrite", { todos: [{ id: "t", status: "completed", evidence: { callID: `c${i}` } }] }, refusal, "error"),
    )
    const next = { tool: "todowrite", input: { todos: [{ id: "t", status: "completed" }] } }
    expect(assess({ parts: todos, next, limits: LIMITS }).type).toBe("correct")
  })

  test("stops a turn whose todowrite calls keep failing, even when every failure is different", () => {
    // Varied malformed calls never repeat an error, so the same-failure streak cannot see them.
    const failed = (i: number) => call("todowrite", { todos: [{ id: `t${i}` }] }, `Invalid task update ${i}`, "error")
    const next = { tool: "todowrite", input: { todos: [{ id: "t" }] } }
    const run = (n: number) => Array.from({ length: n }, (_, i) => failed(i))
    expect(assess({ parts: run(LIMITS.failureStopAt - 1), next, limits: LIMITS }).type).not.toBe("stop")
    const stop = assess({ parts: run(LIMITS.failureStopAt), next, limits: LIMITS })
    expect(stop).toMatchObject({
      type: "stop",
      streak: LIMITS.failureStopAt,
      summary: `Paused: task updates kept failing (${LIMITS.failureStopAt} in a row)`,
    })
    expect(stop.type === "stop" && stop.message).toContain(
      `${LIMITS.failureStopAt} todowrite calls in a row have failed`,
    )
    // Other tools in between do not reset the count; a successful todowrite does.
    const interleaved = run(LIMITS.failureStopAt).flatMap((part) => [call("read", { path: "/a" }, "x"), part])
    expect(assess({ parts: interleaved, next, limits: LIMITS }).type).toBe("stop")
    const recovered = [...run(LIMITS.failureStopAt), call("todowrite", { todos: [] }, "[]")]
    expect(assess({ parts: recovered, next, limits: LIMITS }).type).toBe("ok")
    // Only todowrite is counted this way.
    const edits = Array.from({ length: LIMITS.failureStopAt + 2 }, (_, i) =>
      call("edit", { filePath: "a.ts", oldString: `${i}` }, `miss ${i}`, "error"),
    )
    expect(assess({ parts: edits, next: { tool: "edit", input: {} }, limits: LIMITS }).type).toBe("ok")
  })

  test("cuts the turn at the last real user message, not at a synthetic continuation", () => {
    const user = (parts: Part[]) => ({ info: { role: "user" }, parts })
    const assistant = (parts: Part[]) => ({ info: { role: "assistant" }, parts })
    const refusal = call("todowrite", { todos: [] }, "no evidence", "error")
    const messages = [
      user([{ type: "text" }]),
      assistant([refusal]),
      user([{ type: "text", synthetic: true }]),
      assistant([refusal]),
    ]
    const tools = (parts: Part[]) => parts.filter((part) => part.type === "tool")
    expect(tools(turn(messages))).toHaveLength(2)
    expect(tools(turn([...messages, user([{ type: "text" }, { type: "file" }]), assistant([refusal])]))).toHaveLength(1)
    expect(tools(turn([user([{ type: "text", synthetic: true }])]))).toHaveLength(0)
  })
})

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LLMEvent } from "@opencode/ai"
import { LoopGuard } from "@opencode/core/session/loop-guard"
import { SessionLoopGuard } from "@opencode/core/session/loop-guard-v2"
import { SessionMessage } from "@opencode/core/session/message"

const next = (index: number, oldString = `same ${index}`, newString = oldString) =>
  LLMEvent.toolCall({
    id: `call_${index}`,
    name: "edit",
    input: { path: `src/${index}.tsx`, oldString, newString },
  })

const failed = (index: number, error = "No changes to apply: oldString and newString are identical.") =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: `msg_${index}`,
    type: "assistant",
    agent: "design",
    model: { providerID: "test", id: "model" },
    time: { created: index, completed: index },
    content: [
      { type: "text", text: `Troco de abordagem ${index}: vou criar o symlink via shell agora.` },
      {
        type: "tool",
        name: "edit",
        id: `call_${index}`,
        state: { status: "error", input: next(index).input, error: { type: "tool.execution", message: error } },
        time: { created: index, completed: index },
      },
    ],
  })

describe("V2 no-op edit recovery", () => {
  test("lets the first invalid edit reach the leaf's actionable error", () => {
    expect(SessionLoopGuard.assess([], next(0), LoopGuard.LIMITS)).toEqual({ type: "ok" })
  })

  test("refuses the second no-op despite different paths, strings and narration", () => {
    expect(SessionLoopGuard.assess([failed(0)], next(1), LoopGuard.LIMITS)).toMatchObject({
      type: "correct",
      streak: 2,
      message: expect.stringContaining("design_preview"),
    })
  })

  test("stops the third attempt even when the second error is our recovery warning", () => {
    const warning = SessionLoopGuard.assess([failed(0)], next(1), LoopGuard.LIMITS)
    if (warning.type !== "correct") throw new Error("Expected a recovery warning")
    expect(SessionLoopGuard.assess([failed(1, warning.message), failed(0)], next(2), LoopGuard.LIMITS)).toMatchObject({
      type: "stop",
      streak: 3,
      summary: expect.stringContaining("edits with no changes"),
    })
  })

  test("allows a real edit and a preview after the warning", () => {
    const history = [failed(1), failed(0)]
    expect(SessionLoopGuard.assess(history, next(2, "before", "after"), LoopGuard.LIMITS)).toEqual({ type: "ok" })
    expect(
      SessionLoopGuard.assess(
        history,
        LLMEvent.toolCall({
          id: "call_preview",
          name: "design_preview",
          input: { id: "design_profile", name: "Profile" },
        }),
        LoopGuard.LIMITS,
      ),
    ).toEqual({ type: "ok" })
  })

  test("an intervening real action resets the recovery window", () => {
    const preview = Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: "msg_preview",
      type: "assistant",
      agent: "design",
      model: { providerID: "test", id: "model" },
      time: { created: 2, completed: 2 },
      content: [
        {
          type: "tool",
          id: "call_preview",
          name: "design_preview",
          state: { status: "completed", input: {}, content: [{ type: "text", text: "Published" }] },
          time: { created: 2, completed: 2 },
        },
      ],
    })
    expect(SessionLoopGuard.assess([preview, failed(1), failed(0)], next(3), LoopGuard.LIMITS)).toEqual({ type: "ok" })
  })

  test("a new user message separates two recovery windows", () => {
    const user = Schema.decodeUnknownSync(SessionMessage.User)({
      id: "msg_user",
      type: "user",
      text: "Vamos continuar",
      time: { created: 2 },
    })
    expect(SessionLoopGuard.assess([user, failed(1), failed(0)], next(3), LoopGuard.LIMITS)).toEqual({ type: "ok" })
  })

  test("ordinary edit failures retain the general repetition thresholds", () => {
    const parts: LoopGuard.Part[] = [0, 1].map((index) => ({
      type: "tool",
      tool: "edit",
      state: {
        status: "error",
        input: { path: `src/${index}.tsx`, oldString: "before", newString: "after" },
        error: "Could not find oldString",
      },
    }))
    expect(
      LoopGuard.assess({
        parts,
        next: { tool: "edit", input: next(2, "before", "after").input },
        limits: LoopGuard.LIMITS,
      }),
    ).toEqual({ type: "ok" })
  })

  test("an explicitly disabled loop guard remains disabled", () => {
    expect(
      LoopGuard.assess({
        parts: [0, 1].map((index) => ({
          type: "tool",
          tool: "edit",
          state: { status: "error", input: next(index).input },
        })),
        next: { tool: "edit", input: next(2).input },
      }),
    ).toEqual({ type: "ok" })
  })
})

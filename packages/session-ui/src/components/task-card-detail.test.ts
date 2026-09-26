import { describe, expect, test } from "bun:test"
import { SubagentView } from "@reddb-io/redcode-core/session/subagent-view"
import { taskCardDetail } from "./task-card-detail"

const task = (extra: Record<string, unknown> = {}) => ({
  sessionId: "ses_child",
  model: { providerID: "anthropic", modelID: "claude-opus-5" },
  ...extra,
})

describe("taskCardDetail", () => {
  test("shows the model and variant, the verdict badge and an in-scope checkpoint", () => {
    expect(taskCardDetail(task({ variant: "high", review: { decision: "verified" } }))).toEqual([
      { text: "claude-opus-5 (high)", tone: "muted" },
      { text: "✓ verified", tone: "success" },
      { text: "in scope", tone: "muted" },
    ])
  })

  test.each([
    ["inconclusive", "? inconclusive", "warning"],
    ["needs_revision", "! needs revision", "critical"],
    ["unverified", "~ unverified", "muted"],
  ] as const)("renders the %s verdict with its badge", (decision, text, tone) => {
    expect(taskCardDetail(task({ review: { decision } }))[1]).toEqual({ text, tone })
  })

  test("reads a background task's verdict, model and checkpoints from the child session", () => {
    const child = {
      model: { id: "gpt-6", providerID: "openai", variant: "max" },
      metadata: SubagentView.withCheckpoint(
        SubagentView.withCheckpoint(
          { [SubagentView.BRIEF_KEY]: { brief: "Fix it", result: { decision: "inconclusive", issues: [] } } },
          { action: "steer", line: "S1 · no progress for 5 steps", at: 1 },
        ),
        { action: "stop", line: "S1 · no progress for 9 steps", reason: "it is going around in circles", at: 2 },
      ),
    }
    expect(taskCardDetail({ sessionId: "ses_child" }, child)).toEqual([
      { text: "gpt-6 (max)", tone: "muted" },
      { text: "? inconclusive", tone: "warning" },
      { text: "stopped · it is going around in circles", tone: "critical" },
    ])
  })

  test("says a hint was sent while the latest checkpoint corrected the subagent", () => {
    const child = {
      metadata: SubagentView.withCheckpoint(undefined, { action: "steer", line: "S1 · looping", at: 1 }),
    }
    expect(taskCardDetail(task(), child).at(-1)).toEqual({ text: "corrected (hint sent)", tone: "warning" })
  })
})
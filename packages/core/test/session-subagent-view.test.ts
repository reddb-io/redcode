import { describe, expect, test } from "bun:test"
import { SubagentReview } from "@reddb-io/redcode-core/session/subagent-review"
import { SubagentView } from "@reddb-io/redcode-core/session/subagent-view"

describe("SubagentView", () => {
  test("keeps the latest checkpoints, drops malformed ones, and reads where they left the subagent", () => {
    const kept = Array.from({ length: SubagentView.CHECKPOINT_LIMIT + 3 }, (_, index) => index).reduce<
      Record<string, unknown>
    >(
      (metadata, index) => SubagentView.withCheckpoint(metadata, { action: "steer", line: `step ${index}`, at: index }),
      { [SubagentView.CHECKPOINTS_KEY]: [{ action: "explode", line: "bad" }, "junk"], other: true },
    )
    const list = SubagentView.checkpoints(kept)
    expect(list).toHaveLength(SubagentView.CHECKPOINT_LIMIT)
    expect(list.at(-1)?.line).toBe(`step ${SubagentView.CHECKPOINT_LIMIT + 2}`)
    expect(kept.other).toBe(true)
    expect(SubagentView.checkpointState(list)).toEqual({ type: "corrected", line: list.at(-1)!.line })
    expect(SubagentView.checkpointState([])).toEqual({ type: "in_scope" })

    const stopped = SubagentView.checkpoints(
      SubagentView.withCheckpoint(kept, { action: "stop", line: "S1 · looping", reason: "it loops", at: 99 }),
    )
    expect(SubagentView.checkpointState(stopped)).toEqual({ type: "stopped", line: "S1 · looping", reason: "it loops" })
    expect(SubagentView.status({ busy: false, checkpoints: stopped })).toBe("stopped")
    expect(SubagentView.status({ busy: true, checkpoints: stopped })).toBe("running")
    expect(SubagentView.status({ busy: false, checkpoints: list })).toBe("done")
  })

  test("reads the brief the task tool stores", () => {
    const metadata = SubagentReview.toMetadata(undefined, {
      brief: "Find why the login test fails",
      agent: "general",
      scope: ["packages/auth/**"],
      criteria: ["the failing test passes"],
      returnFormat: "a short report",
      writeCapable: true,
      parentSessionID: "ses_parent",
      verdict: "verified",
      issues: [],
      created: 1,
      result: { decision: "unverified", issues: [], repaired: true },
    })
    expect(SubagentView.brief(metadata)).toEqual({
      goal: "Find why the login test fails",
      scope: ["packages/auth/**"],
      criteria: ["the failing test passes"],
      returnFormat: "a short report",
    })
    expect(SubagentView.decision(undefined, metadata)).toBe("unverified")
    expect(SubagentView.brief({})).toBeUndefined()
  })
})

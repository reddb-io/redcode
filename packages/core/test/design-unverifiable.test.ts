import { describe, expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignRounds } from "@opencode/core/design/rounds"
import { UNAVAILABLE, unavailable } from "@opencode/core/design/renderer-local"

const designID = Design.ID.make("design_checkout")
const feedback = SessionMessage.ID.make("msg_1")
const opened = DesignRounds.admit(
  { rounds: undefined, notes: undefined },
  {
    id: feedback,
    revision: "rev_1",
    text: "",
    items: [{ target: "#title", text: "Bigger" }],
    assets: [],
    snapshot: "",
    delivery: "steer",
    end: false,
  },
  100,
)
const answered = { ...DesignRounds.published(opened, "rev_2"), revision: "rev_2" }
const verify = (id: string, revision: string, status: Design.Job["status"], created: number): Design.Job => ({
  id,
  designID,
  input: { revision, format: "verify", round: 1 },
  status,
  progress: status === "completed" ? 1 : 0,
  result: null,
  error: status === "failed" ? `${UNAVAILABLE} Chromium setup failed.` : null,
  created,
  ...(status === "completed"
    ? {
        verify: {
          revision,
          round: 1,
          width: 1440,
          notes: [
            {
              feedback,
              index: 1,
              label: "note",
              found: true,
              blocking: false,
              findings: [],
              scenarios: [],
              reason: "found",
            },
          ],
          findings: [],
        },
      }
    : {}),
})
const gate = (update: Design.NoteUpdate, jobs: ReadonlyArray<Design.Job>) =>
  DesignRounds.triage(answered, [update], jobs).checked[0]!.refusal
const reason = "verification unavailable: Chromium could not be installed offline"

describe("a verify that failed for the current revision", () => {
  test("lets partial carry the reason, cited or not, and never resolved", () => {
    const failed = verify("render_failed", "rev_2", "failed", 30)
    expect(
      gate({ feedback, index: 1, status: "partial", reason, evidence: { job: failed.id } }, [failed]),
    ).toBeUndefined()
    expect(gate({ feedback, index: 1, status: "partial", reason }, [failed])).toBeUndefined()
    expect(gate({ feedback, index: 1, status: "partial", evidence: { job: failed.id } }, [failed])).toContain(
      '"verification unavailable: <cause>"',
    )
    expect(gate({ feedback, index: 1, status: "resolved", evidence: { job: failed.id } }, [failed])).toContain(
      "is not a completed verify job",
    )
    // Unresolved and accepted may cite it too.
    expect(
      gate({ feedback, index: 1, status: "unresolved", reason, evidence: { job: failed.id } }, [failed]),
    ).toBeUndefined()
    // The failed job is recorded as the evidence, with no capture.
    const recorded = DesignRounds.apply(
      answered,
      [{ feedback, index: 1, status: "partial", reason, evidence: { job: failed.id } }],
      [failed],
      900,
    )
    if ("problem" in recorded) throw new Error(recorded.problem)
    expect(recorded.notes[0]).toMatchObject({
      status: "partial",
      reason,
      evidence: { job: failed.id, revision: "rev_2" },
    })
  })

  test("does not relax partial for an older revision or once a newer verify completed", () => {
    const old = verify("render_old", "rev_1", "failed", 30)
    expect(gate({ feedback, index: 1, status: "partial", reason, evidence: { job: old.id } }, [old])).toContain(
      "is not a completed verify job",
    )
    expect(gate({ feedback, index: 1, status: "partial", reason }, [old])).toContain("needs evidence")
    const failed = verify("render_failed", "rev_2", "failed", 30)
    const completed = verify("render_done", "rev_2", "completed", 40)
    // Uncited, the newest verify of the round decides: it completed, so it must be cited.
    expect(gate({ feedback, index: 1, status: "partial", reason }, [failed, completed])).toContain("needs evidence")
    expect(
      gate({ feedback, index: 1, status: "partial", reason, evidence: { job: completed.id } }, [failed, completed]),
    ).toBeUndefined()
  })
})

describe("a renderer that cannot get a browser", () => {
  test("tells the agent retrying will not help and, for a verify, which outcome to record", () => {
    const cause = new Design.Error({
      code: "unavailable",
      message: "Chromium setup failed or exceeded its three-minute limit.",
    })
    const verifying = unavailable({ id: "render_1", input: { revision: "rev_2", format: "verify", round: 1 } })(cause)
    expect(verifying.message).toStartWith(`${UNAVAILABLE} Chromium setup failed`)
    expect(verifying.message).toContain("do not retry in a loop")
    expect(verifying.message).toContain('partial (or unresolved) with the reason "verification unavailable: <cause>"')
    expect(verifying.message).toContain('{"job":"render_1"}')
    const exporting = unavailable({ id: "render_2", input: { revision: "rev_2", format: "html" } })(cause)
    expect(exporting.message).not.toContain("partial")
    expect(exporting.message).toContain("Tell the user what failed")
    // Wrapping twice keeps one explanation.
    expect(unavailable({ id: "render_1", input: { revision: "rev_2", format: "verify" } })(verifying)).toBe(verifying)
  })
})

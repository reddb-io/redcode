import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionMessage } from "@reddb-io/redcode-schema/session-message"
import { DesignRounds } from "../src/design/rounds"

const designID = Schema.decodeUnknownSync(Design.ID)("design_checkout")
const message = (id: string, revision: string, items: Design.FeedbackItem[]): Design.Feedback => ({
  id: SessionMessage.ID.make(id),
  revision,
  text: "",
  items,
  assets: [],
  snapshot: "",
  delivery: "steer",
  end: false,
})
const note = (target: string, text: string, label?: string): Design.FeedbackItem => ({
  target,
  text,
  ...(label ? { label } : {}),
})
const job = (id: string, revision: string, round: number, notes: Design.VerifyNote[], status = "completed" as const) =>
  ({
    id,
    designID,
    input: { revision, format: "verify", round },
    status,
    progress: 1,
    result: `${id}.html`,
    error: null,
    created: 10,
    finished: 20,
    verify: { revision, round, width: 1440, notes, findings: [] },
  }) satisfies Design.Job
const seen = (
  feedback: string,
  index: number,
  found: boolean,
  extra: Partial<Design.VerifyNote> = {},
): Design.VerifyNote => ({
  feedback,
  index,
  label: "note",
  found,
  blocking: !found,
  findings: [],
  scenarios: [],
  reason: found ? "found; no findings" : "element not found",
  ...extra,
})

describe("DesignRounds", () => {
  test("notes join the open round until a revision answers it; later notes open the next round", () => {
    const empty = { rounds: undefined, notes: undefined }
    expect(DesignRounds.next(empty)).toBe(1)
    const first = DesignRounds.admit(
      empty,
      message("msg_1", "rev_1", [note("variant:stone", ""), note("#title", "Bigger", 'h1 "Checkout"')]),
      100,
    )
    expect(first.rounds).toEqual([{ number: 1, opened: 100, revision: "rev_1", feedback: ["msg_1"] }])
    // The variant marker is metadata: the first real note is #1, matching the rendered numbering.
    expect(first.notes).toHaveLength(1)
    expect(first.notes![0]).toMatchObject({ feedback: "msg_1", index: 1, round: 1, status: "open", updated: 100 })
    expect(first.notes![0].item.label).toBe('h1 "Checkout"')
    const second = DesignRounds.admit(first, message("msg_2", "rev_1", [note("#submit", "Verb")]), 200)
    expect(second.rounds).toEqual([{ number: 1, opened: 100, revision: "rev_1", feedback: ["msg_1", "msg_2"] }])
    expect(DesignRounds.open(second).map((item) => `${item.feedback}#${item.index}`)).toEqual(["msg_1#1", "msg_2#1"])
    // Admitting the same message again changes nothing.
    expect(DesignRounds.admit(second, message("msg_2", "rev_1", [note("#submit", "Verb")]), 300)).toBe(second)
    const answered = DesignRounds.published(second, "rev_2")
    expect(DesignRounds.latest(answered)?.published).toBe("rev_2")
    // A second publish does not move the round's answer.
    expect(DesignRounds.published(answered, "rev_3")).toBe(answered)
    expect(DesignRounds.next(answered)).toBe(2)
    const third = DesignRounds.admit(answered, message("msg_3", "rev_2", [note("#footer", "Smaller")]), 400)
    expect(third.rounds).toHaveLength(2)
    expect(third.rounds![1]).toEqual({ number: 2, opened: 400, revision: "rev_2", feedback: ["msg_3"] })
    expect(DesignRounds.open(third).map((item) => item.feedback)).toEqual(["msg_3"])
    expect(DesignRounds.notes(third, 1)).toHaveLength(2)
    expect(DesignRounds.summary(third)).toBe(
      "round 1 (answered by rev_2): 2 open; round 2 (awaiting a revision): 1 open",
    )
    // A message without notes (a plain message or a variant operation) opens no round.
    expect(DesignRounds.admit(empty, message("msg_0", "rev_1", []), 50)).toBe(empty)
  })

  test("status updates name existing notes and copy the cited verify job's observation into the evidence", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#title", "Bigger"), note("#gone", "Remove")]),
      100,
    )
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true, { after: "/captures/render_1-0-after.png", findings: ["review · small-control"] }),
      seen("msg_1", 2, false),
    ])
    const applied = DesignRounds.apply(
      opened,
      [
        { feedback: SessionMessage.ID.make("msg_1"), index: 1, status: "resolved", evidence: { job: "render_1" } },
        { feedback: SessionMessage.ID.make("msg_1"), index: 2, status: "accepted", reason: "Kept on purpose" },
      ],
      [verify],
      500,
    )
    if ("problem" in applied) throw new Error(applied.problem)
    expect(applied.notes[0]).toMatchObject({
      status: "resolved",
      updated: 500,
      evidence: {
        job: "render_1",
        revision: "rev_2",
        capture: "/captures/render_1-0-after.png",
        findings: ["review · small-control"],
      },
    })
    expect(applied.notes[0].reason).toBeUndefined()
    expect(applied.notes[1]).toMatchObject({ status: "accepted", reason: "Kept on purpose" })
    expect(applied.notes[1].evidence).toBeUndefined()
    // A repeated status keeps its reason and evidence; a changed status starts over.
    const repeated = DesignRounds.apply(
      { ...opened, notes: applied.notes },
      [{ feedback: SessionMessage.ID.make("msg_1"), index: 2, status: "accepted" }],
      [verify],
      600,
    )
    if ("problem" in repeated) throw new Error(repeated.problem)
    expect(repeated.notes[1]).toMatchObject({ status: "accepted", reason: "Kept on purpose", updated: 600 })
    const changed = DesignRounds.apply(
      { ...opened, notes: applied.notes },
      [{ feedback: SessionMessage.ID.make("msg_1"), index: 1, status: "unresolved", reason: "Still clipped" }],
      [verify],
      700,
    )
    if ("problem" in changed) throw new Error(changed.problem)
    expect(changed.notes[0]).toMatchObject({ status: "unresolved", reason: "Still clipped" })
    expect(changed.notes[0].evidence).toBeUndefined()
  })

  test("an unknown note or a job that is not a completed verify is refused with the candidates named", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#title", "Bigger")]),
      100,
    )
    const missing = DesignRounds.apply(
      opened,
      [{ feedback: SessionMessage.ID.make("msg_9"), index: 1, status: "resolved" }],
      [],
    )
    const problem = (result: ReturnType<typeof DesignRounds.apply>) => ("problem" in result ? result.problem : "")
    expect(problem(missing)).toContain("Unknown note msg_9 #1")
    expect(problem(missing)).toContain("msg_1 #1 (round 1, open)")
    const { verify: _, ...running } = job("render_2", "rev_2", 1, [], "running" as never)
    const audit = { ...job("render_3", "rev_2", 1, []), input: { revision: "rev_2", format: "audit" as const } }
    const refused = DesignRounds.apply(
      opened,
      [{ feedback: SessionMessage.ID.make("msg_1"), index: 1, status: "resolved", evidence: { job: "render_3" } }],
      [running, audit, job("render_1", "rev_2", 1, [seen("msg_1", 1, true)])],
    )
    expect(problem(refused)).toContain("Evidence job render_3 is not a completed verify job of this design")
    expect(problem(refused)).toContain(
      "render_1 (revision rev_2, round 1, completed, 1 of 1 notes found without blocking findings)",
    )
    expect(problem(refused)).toContain("render_2 (revision rev_2, round 1, running)")
    expect(problem(refused)).not.toContain("render_3 (")
    expect(DesignRounds.describeJobs([])).toContain("Verify jobs: none")
  })

  test("verdicts follow what the verify observed", () => {
    expect(DesignRounds.verdict({ found: true, blocking: false, findings: [] })).toBe("pass")
    expect(DesignRounds.verdict({ found: true, blocking: false, findings: ["review · small-control"] })).toBe("warn")
    expect(DesignRounds.verdict({ found: true, blocking: true, findings: ["error · color-contrast"] })).toBe("fail")
    expect(DesignRounds.verdict({ found: false, blocking: true, findings: [] })).toBe("fail")
  })
})

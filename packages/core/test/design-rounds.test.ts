import { describe, expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignRounds } from "@opencode/core/design/rounds"

const designID = Design.ID.make("design_checkout")
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
const job = (
  id: string,
  revision: string,
  round: number,
  notes: Design.VerifyNote[],
  status: Design.Job["status"] = "completed",
) =>
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
    // Open notes of every round count until they are recorded, not only the latest round's.
    expect(DesignRounds.open(third).map((item) => item.feedback)).toEqual(["msg_1", "msg_2", "msg_3"])
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
    const running: Design.Job = { ...job("render_2", "rev_2", 1, [], "running"), verify: undefined }
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
    // A completed verify of another round never stands as evidence for this note.
    const elsewhere = job("render_4", "rev_2", 2, [seen("msg_9", 1, true)])
    expect(
      problem(
        DesignRounds.apply(
          opened,
          [{ feedback: SessionMessage.ID.make("msg_1"), index: 1, status: "resolved", evidence: { job: "render_4" } }],
          [elsewhere],
        ),
      ),
    ).toContain("Evidence job render_4 did not cover note msg_1 #1 (it verified round 2)")
    expect(problem(refused)).not.toContain("render_3 (")
    expect(DesignRounds.describeJobs([])).toContain("Verify jobs: none")
  })

  test("the status gate needs a passing verify on the current revision for resolved and a reason otherwise", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#title", "Bigger"), note("#gone", "Remove"), note("#cta", "Contrast")]),
      100,
    )
    const answered = { ...DesignRounds.published(opened, "rev_2"), revision: "rev_2" }
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true),
      seen("msg_1", 2, false),
      seen("msg_1", 3, true, {
        blocking: true,
        findings: ["error · color-contrast: Elements must have sufficient color contrast (1 elements)"],
      }),
    ])
    const stale = job("render_0", "rev_1", 1, [seen("msg_1", 1, true)])
    const feedback = SessionMessage.ID.make("msg_1")
    const gate = (update: Design.NoteUpdate, jobs = [stale, verify], by?: Design.NoteRecorder) =>
      DesignRounds.triage(answered, [update], jobs, by).checked[0].refusal
    // Resolved: evidence is required, must be a verify of the current revision, and must have found the element cleanly.
    expect(gate({ feedback, index: 1, status: "resolved" })).toContain(
      `${DesignRounds.REFUSED} resolved for msg_1 #1 needs evidence`,
    )
    // A refusal about evidence points at the verify jobs, which the caller lists.
    expect(DesignRounds.triage(answered, [{ feedback, index: 1, status: "resolved" }], [stale, verify]).see).toEqual([
      "jobs",
    ])
    expect(gate({ feedback, index: 1, status: "resolved", evidence: { job: "render_0" } })).toContain(
      "verified rev_1, not the current revision rev_2",
    )
    expect(gate({ feedback, index: 1, status: "resolved", evidence: { job: "render_9" } })).toContain(
      "render_9 is not a completed verify job",
    )
    expect(gate({ feedback, index: 1, status: "resolved", evidence: { job: "render_1" } })).toBeUndefined()
    expect(gate({ feedback, index: 2, status: "resolved", evidence: { job: "render_1" } })).toContain(
      "did not find its element in rev_2",
    )
    expect(gate({ feedback, index: 3, status: "resolved", evidence: { job: "render_1" } })).toContain(
      "found blocking findings for it (error · color-contrast",
    )
    // A verify that did not cover the note is no evidence for it.
    const other = job("render_2", "rev_2", 2, [seen("msg_9", 1, true)])
    expect(gate({ feedback, index: 1, status: "resolved", evidence: { job: "render_2" } }, [other])).toContain(
      'verified round 2, not msg_1 #1 (round 1). Run design_export {"revision":"rev_2","format":"verify","round":1} and cite that job.',
    )
    // The reviewer may close a note by hand, but only as accepted or unresolved, with a reason.
    expect(
      gate({ feedback, index: 1, status: "resolved", evidence: { job: "render_1" } }, [verify], "reviewer"),
    ).toContain("the reviewer records a note as accepted or unresolved")
    expect(gate({ feedback, index: 1, status: "accepted" }, [], "reviewer")).toContain("needs a reason")
    expect(gate({ feedback, index: 1, status: "accepted", reason: "Fine as is" }, [], "reviewer")).toBeUndefined()
    const byReviewer = DesignRounds.apply(
      answered,
      [{ feedback, index: 1, status: "accepted", reason: "Fine as is" }],
      [],
      900,
      "reviewer",
    )
    if ("problem" in byReviewer) throw new Error(byReviewer.problem)
    expect(byReviewer.notes[0]).toMatchObject({ status: "accepted", by: "reviewer", reason: "Fine as is" })
    // Partial: the job (whatever it saw) plus a reason. Unresolved and accepted: a reason.
    expect(gate({ feedback, index: 2, status: "partial", evidence: { job: "render_1" } })).toContain(
      "partial for msg_1 #2 needs a reason",
    )
    expect(
      gate({ feedback, index: 2, status: "partial", evidence: { job: "render_1" }, reason: "Moved, not gone" }),
    ).toBeUndefined()
    expect(gate({ feedback, index: 2, status: "partial", reason: "Moved" })).toContain(
      "partial for msg_1 #2 needs evidence",
    )
    expect(gate({ feedback, index: 2, status: "unresolved" })).toContain("unresolved for msg_1 #2 needs a reason")
    expect(gate({ feedback, index: 2, status: "accepted", reason: "  " })).toContain(
      "accepted for msg_1 #2 needs a reason",
    )
    expect(gate({ feedback, index: 2, status: "accepted", reason: "Kept on purpose" }, [])).toBeUndefined()
    expect(gate({ feedback, index: 2, status: "unresolved", reason: "Still there" }, [])).toBeUndefined()
    // Evidence is optional for those two, but a job they do cite must be a verify that saw the note,
    // on whatever revision.
    const kept = { feedback, index: 2, status: "accepted", reason: "Kept on purpose" } as const
    expect(gate({ ...kept, evidence: { job: "render_0" } }, [stale])).toContain(
      "Evidence job render_0 verified round 1, not msg_1 #2 (round 1)",
    )
    expect(gate({ ...kept, evidence: { job: "render_9" } })).toContain("render_9 is not a completed verify job")
    expect(gate({ ...kept, index: 1, evidence: { job: "render_0" } })).toBeUndefined()
    // A note that is not recorded is said to be unknown before anything about its evidence, whoever asks.
    const unknown = "Unknown note msg_9 #4."
    const mistyped = SessionMessage.ID.make("msg_9")
    expect(gate({ feedback: mistyped, index: 4, status: "resolved", evidence: { job: "render_9" } })).toBe(unknown)
    expect(gate({ feedback: mistyped, index: 4, status: "resolved" }, [], "reviewer")).toBe(unknown)
    expect(gate({ feedback: mistyped, index: 4, status: "accepted" })).toBe(unknown)
    // It points at the recorded notes, not at the verify jobs.
    expect(
      DesignRounds.triage(
        answered,
        [{ feedback: mistyped, index: 4, status: "resolved", evidence: { job: "render_9" } }],
        [stale, verify],
      ).see,
    ).toEqual(["notes"])
    // The blocker names the open notes and lifts once every note has an outcome.
    expect(DesignRounds.blocking(answered)).toContain(
      "Round 1 has 3 notes without a recorded outcome: msg_1 #1 (#title), msg_1 #2 (#gone), msg_1 #3 (#cta)",
    )
    // It ends on the call that lists that round's notes with their text.
    expect(DesignRounds.blocking(answered)).toEndWith(
      'unresolved or accepted with a reason are allowed. Every note of a round with its text: design_read {"section":"notes","round":1}.',
    )
    expect(DesignRounds.blocking({ ...answered, id: designID })).toEndWith(
      'Every note of a round with its text: design_read {"id":"design_checkout","section":"notes","round":1}.',
    )
    const recorded = DesignRounds.apply(
      answered,
      [
        { feedback, index: 1, status: "resolved", evidence: { job: "render_1" } },
        { feedback, index: 2, status: "accepted", reason: "Kept on purpose" },
        { feedback, index: 3, status: "unresolved", reason: "Contrast still fails" },
      ],
      [verify],
    )
    if ("problem" in recorded) throw new Error(recorded.problem)
    expect(DesignRounds.blocking({ ...answered, notes: recorded.notes })).toBeUndefined()
    expect(DesignRounds.blocking({ rounds: undefined, notes: undefined })).toBeUndefined()
    // An older round's notes keep blocking after a newer round opened and was recorded.
    const later = DesignRounds.admit(answered, message("msg_2", "rev_2", [note("#footer", "Smaller")]), 1000)
    const onlyLatest = DesignRounds.apply(
      later,
      [{ feedback: SessionMessage.ID.make("msg_2"), index: 1, status: "accepted", reason: "Footer stays" }],
      [],
    )
    if ("problem" in onlyLatest) throw new Error(onlyLatest.problem)
    expect(DesignRounds.blocking({ ...later, notes: onlyLatest.notes })).toContain(
      "Round 1 has 3 notes without a recorded outcome: msg_1 #1 (#title), msg_1 #2 (#gone), msg_1 #3 (#cta). Fix them",
    )
    const bothOpen = DesignRounds.blocking(later)
    expect(bothOpen).toContain("Round 1 has 3 notes without a recorded outcome")
    expect(bothOpen).toContain("; round 2 has 1 note without a recorded outcome: msg_2 #1 (#footer)")
    // With more than one round pending, the round to read is left to the caller.
    expect(bothOpen).toEndWith('design_read {"section":"notes","round":<round>}.')
    expect(DesignRounds.open(later)).toHaveLength(4)
  })

  test("the blocker names eight notes of a round and counts the rest", () => {
    const many = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message(
        "msg_1",
        "rev_1",
        Array.from({ length: 14 }, (_, index) => note(`#n${index + 1}`, `Note ${index + 1}`)),
      ),
      100,
    )
    expect(DesignRounds.blocking(many)).toStartWith(
      `Round 1 has 14 notes without a recorded outcome: ${Array.from({ length: 8 }, (_, index) => `msg_1 #${index + 1} (#n${index + 1})`).join(", ")} and 6 more. Fix them`,
    )
  })

  test("every status of an update is judged on its own, and what the refusals point at is listed once", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#title", "Bigger"), note("#gone", "Remove"), note("#cta", "Contrast")]),
      100,
    )
    const answered = { ...DesignRounds.published(opened, "rev_2"), revision: "rev_2" }
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true),
      seen("msg_1", 2, false),
      seen("msg_1", 3, true),
    ])
    const feedback = SessionMessage.ID.make("msg_1")
    const updates: Design.NoteUpdate[] = [
      { feedback, index: 1, status: "resolved", evidence: { job: "render_1" } },
      { feedback: SessionMessage.ID.make("msg_9"), index: 1, status: "resolved", evidence: { job: "render_1" } },
      { feedback, index: 2, status: "resolved", evidence: { job: "render_1" } },
      { feedback, index: 3, status: "partial", evidence: { job: "render_1" } },
      { feedback, index: 2, status: "accepted", reason: "Kept on purpose" },
      { feedback: SessionMessage.ID.make("msg_9"), index: 2, status: "accepted", reason: "Kept on purpose" },
    ]
    const known = "Known notes: msg_1 #1 (round 1, open), msg_1 #2 (round 1, open), msg_1 #3 (round 1, open)."
    const listed =
      "Recent verify jobs (newest first): render_1 (revision rev_2, round 1, completed, 2 of 3 notes found without blocking findings)."

    const triaged = DesignRounds.triage(answered, updates, [verify])
    expect(triaged.checked.map((item) => item.update)).toEqual(updates)
    expect(triaged.checked.map((item) => item.refusal)).toEqual([
      undefined,
      "Unknown note msg_9 #1.",
      "Note status refused: msg_1 #2 cannot be resolved: render_1 did not find its element in rev_2 (element not found). Record it unresolved or accepted with a reason, or restore the element and verify again.",
      "Note status refused: partial for msg_1 #3 needs a reason saying what still differs from the note.",
      undefined,
      "Unknown note msg_9 #2.",
    ])
    // Two unknown notes and one refusal about evidence: the caller lists the notes and the jobs once each.
    expect(triaged.see).toEqual(["notes", "jobs"])
    // A list no refusal points at is left out.
    expect(DesignRounds.triage(answered, [updates[0], updates[1], updates[3]], [verify]).see).toEqual(["notes"])
    expect(DesignRounds.triage(answered, [updates[0], updates[2], updates[3]], [verify]).see).toEqual(["jobs"])
    expect(DesignRounds.triage(answered, [updates[0], updates[3]], [verify]).see).toEqual([])
    expect(DesignRounds.triage(answered, [], [verify])).toEqual({ checked: [], see: [] })

    expect(
      DesignRounds.refusals({
        refused: [
          { feedback: "msg_9", index: 1, reason: "Unknown note msg_9 #1." },
          { feedback: "msg_1", index: 2, reason: "Note status refused: no element." },
        ],
        context: [known, listed],
      }),
    ).toEqual(["msg_9 #1: Unknown note msg_9 #1.", "msg_1 #2: Note status refused: no element.", known, listed])
    expect(DesignRounds.refusals({ refused: [], context: [] })).toEqual([])
  })

  test("a claimed fix is shown to a review as the reviewer's request and that note's own observation", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [
        {
          target: 'tr[data-design-id="row"]:nth-of-type(3) [data-design-id="rotate"]',
          text: "Rotate per secret",
          label: 'button "Rotate" in row "Webhooks"',
          elementText: "Rotate",
          selectedText: "Rotate",
          xpath: "/html/body/main/table/tbody/tr[3]/td[4]/button",
          context: "main > table",
          parent: "td (/html/body/main/table/tbody/tr[3]/td[4])",
          params: { values: { clients: { rows: 3 } }, screen: "clients" },
        },
        note("#other", "Another note"),
      ]),
      100,
    )
    const feedback = SessionMessage.ID.make("msg_1")
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true, {
        before: "/captures/render_1-0-before.png",
        after: "/captures/render_1-0-after.png",
        findings: ["review · small-control"],
        scenarios: ["Clients list: exercised"],
      }),
      seen("msg_1", 2, true),
    ])
    const other = job("render_0", "rev_1", 1, [seen("msg_1", 1, false)])

    expect(DesignRounds.isClaim({ status: "resolved" })).toBe(true)
    expect(DesignRounds.isClaim({ status: "partial" })).toBe(true)
    expect(DesignRounds.isClaim({ status: "unresolved" })).toBe(false)
    expect(DesignRounds.isClaim({ status: "accepted" })).toBe(false)
    // No locator, no capture path, no other note and no other job.
    expect(
      DesignRounds.claim(opened, { feedback, index: 1, status: "resolved", evidence: { job: "render_1" } }, [
        other,
        verify,
      ]),
    ).toEqual({
      request: {
        text: "Rotate per secret",
        label: 'button "Rotate" in row "Webhooks"',
        elementText: "Rotate",
        screen: "clients",
      },
      observation: {
        job: "render_1",
        found: true,
        blocking: false,
        reason: "found; no findings",
        findings: ["review · small-control"],
        scenarios: ["Clients list: exercised"],
      },
    })
  })

  test("verdicts follow what the verify observed", () => {
    expect(DesignRounds.verdict({ found: true, blocking: false, findings: [] })).toBe("pass")
    expect(DesignRounds.verdict({ found: true, blocking: false, findings: ["review · small-control"] })).toBe("warn")
    expect(DesignRounds.verdict({ found: true, blocking: true, findings: ["error · color-contrast"] })).toBe("fail")
    expect(DesignRounds.verdict({ found: false, blocking: true, findings: [] })).toBe("fail")
  })
})

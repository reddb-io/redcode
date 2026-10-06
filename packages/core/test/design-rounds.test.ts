import { describe, expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignRounds } from "@opencode/core/design/rounds"
import { DesignVerify } from "@opencode/core/design/verify"

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
    // The blocker counts the open notes, says what to do and where to read them, then quotes them; it
    // lifts once every note has an outcome.
    expect(DesignRounds.blocking(answered)).toBe(
      [
        'Round 1 has 3 notes without a recorded outcome. Fix them, mark each with design_document update addressed, publish one revision, run one verify per round (design_export format verify with round set) and record each note with design_document update notes; unresolved or accepted with a reason are allowed. Every note of a round with its text: design_read {"section":"notes","round":1}.',
        "Round 1: 0 of 3 addressed, 0 recorded. Still without an outcome:",
        "msg_1 #1 [open] #title",
        "Note: Bigger",
        "msg_1 #2 [open] #gone",
        "Note: Remove",
        "msg_1 #3 [open] #cta",
        "Note: Contrast",
      ].join("\n"),
    )
    expect(DesignRounds.blocking({ ...answered, id: designID })).toContain(
      'Every note of a round with its text: design_read {"id":"design_checkout","section":"notes","round":1}.\n',
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
    expect(DesignRounds.blocking({ ...later, notes: onlyLatest.notes })).toStartWith(
      "Round 1 has 3 notes without a recorded outcome. Fix them",
    )
    const bothOpen = DesignRounds.blocking(later)!
    expect(bothOpen).toStartWith(
      "Round 1 has 3 notes without a recorded outcome; round 2 has 1 note without a recorded outcome. Fix them",
    )
    // With more than one round pending, the round to read is left to the caller.
    expect(bothOpen).toContain('design_read {"section":"notes","round":<round>}.\n')
    // The newest round is quoted first.
    expect(bothOpen.indexOf("Round 2: 0 of 1 addressed")).toBeLessThan(bothOpen.indexOf("Round 1: 0 of 3 addressed"))
    expect(DesignRounds.open(later)).toHaveLength(4)
  })

  test("the blocker quotes thirty notes and counts the rest", () => {
    const many = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message(
        "msg_1",
        "rev_1",
        Array.from({ length: 14 }, (_, index) => note(`#n${index + 1}`, `Note ${index + 1}`)),
      ),
      100,
    )
    expect(DesignRounds.blocking(many)).toStartWith("Round 1 has 14 notes without a recorded outcome. Fix them")
    const more = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message(
        "msg_1",
        "rev_1",
        Array.from({ length: 34 }, (_, index) => note(`#n${index + 1}`, `Note ${index + 1}`)),
      ),
      100,
    )
    const lines = DesignRounds.blocking(more)!.split("\n")
    expect(lines[1]).toBe("Round 1: 0 of 34 addressed, 0 recorded. Still without an outcome:")
    expect(lines).toHaveLength(2 + 30 * 2 + 1)
    expect(lines.at(-1)).toBe("and 4 more")
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
      // Neither an addressed mark nor a delta: no change to show.
      change: undefined,
    })
  })

  test("verdicts follow what the verify observed", () => {
    expect(DesignRounds.verdict({ found: true, blocking: false, findings: [] })).toBe("pass")
    expect(DesignRounds.verdict({ found: true, blocking: false, findings: ["review · small-control"] })).toBe("warn")
    expect(DesignRounds.verdict({ found: true, blocking: true, findings: ["error · color-contrast"] })).toBe("fail")
    expect(DesignRounds.verdict({ found: false, blocking: true, findings: [] })).toBe("fail")
  })
})

describe("DesignRounds checklist", () => {
  const opened = (count: number, text = (index: number) => `Note ${index}`) =>
    DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message(
        "msg_1",
        "rev_1",
        Array.from({ length: count }, (_, index) => note(`#n${index + 1}`, text(index + 1))),
      ),
      100,
    )
  const feedback = SessionMessage.ID.make("msg_1")

  test("a mark sets addressed on an open note and keeps its status; an outcome or an unknown note keeps it out", () => {
    const recorded = DesignRounds.apply(
      opened(3),
      [{ feedback, index: 3, status: "accepted", reason: "Kept" }],
      [],
      200,
    )
    if ("problem" in recorded) throw new Error(recorded.problem)
    const marked = DesignRounds.tick(
      { rounds: opened(3).rounds, notes: recorded.notes },
      [
        { feedback, index: 1, summary: "Bigger" },
        { feedback, index: 3, summary: "Changed anyway" },
        { feedback: SessionMessage.ID.make("msg_9"), index: 1, summary: "Elsewhere" },
        { feedback, index: 1, summary: "Bigger and bolder" },
      ],
      300,
    )
    expect(marked.notes.map((item) => [item.status, item.addressed])).toEqual([
      // A second mark of the same note replaces the summary.
      ["open", { summary: "Bigger and bolder", at: 300 }],
      ["open", undefined],
      ["accepted", undefined],
    ])
    expect(marked.ticked).toMatchObject({
      applied: 2,
      ignored: [
        { feedback, index: 3, reason: "already recorded accepted; the outcome stands and the mark was ignored." },
      ],
      refused: [{ feedback: "msg_9", index: 1, reason: "Unknown note msg_9 #1." }],
    })
    expect(marked.ticked.context[0]).toStartWith("Known notes: msg_1 #1 (round 1, open)")
    // Recording an outcome later keeps the mark; ending the round still waits for the outcome.
    const after = DesignRounds.apply(
      { notes: marked.notes, rounds: opened(3).rounds },
      [{ feedback, index: 1, status: "unresolved", reason: "Not enough" }],
      [],
    )
    if ("problem" in after) throw new Error(after.problem)
    expect(after.notes[0]).toMatchObject({ status: "unresolved", addressed: { summary: "Bigger and bolder" } })
    expect(DesignRounds.open({ notes: marked.notes, rounds: undefined })).toHaveLength(2)
    expect(DesignRounds.blocking({ notes: marked.notes, rounds: opened(3).rounds })).toBeDefined()
  })

  test("only the open round's notes without a mark or an outcome keep a publish from answering it", () => {
    expect(DesignRounds.unanswerable({ rounds: undefined, notes: undefined })).toBeUndefined()
    const round = opened(35, (index) => `${"w".repeat(250)} ${index}`)
    const refusal = DesignRounds.unanswerable(round)!
    const lines = refusal.split("\n")
    expect(lines[0]).toBe(
      "Publish refused: this revision would answer feedback round 1, and 35 of its notes have neither an addressed mark nor an outcome:",
    )
    // Thirty notes are quoted, each clipped to 200 code points, then the rest are counted and the exits named.
    expect(lines).toHaveLength(1 + 30 * 2 + 1 + 1)
    expect(lines[2]).toBe(`Note: ${"w".repeat(200)}…`)
    expect(lines.at(-2)).toBe("and 5 more")
    expect(lines.at(-1)).toContain('design_document update {"addressed":[')
    expect(lines.at(-1)).toContain('"status":"unresolved|accepted","reason":"<why>"')
    // An answered round is not gated, even with notes still open: only the next answer is.
    expect(DesignRounds.unanswerable(DesignRounds.published(round, "rev_2"))).toBeUndefined()
    const marked = DesignRounds.tick(
      round,
      Array.from({ length: 35 }, (_, index) => ({ feedback, index: index + 1, summary: "Done" })),
    )
    expect(DesignRounds.unanswerable({ ...round, notes: marked.notes })).toBeUndefined()
  })

  test("the recitation says each round's progress and is empty once every note has an outcome", () => {
    const round = opened(2)
    const marked = DesignRounds.tick(round, [{ feedback, index: 2, summary: "Done" }], 200)
    expect(DesignRounds.recite({ ...round, notes: marked.notes })).toBe(
      [
        "Round 1: 1 of 2 addressed, 0 recorded. Still without an outcome:",
        "msg_1 #1 [open] #n1",
        "Note: Note 1",
        "msg_1 #2 [open, addressed] #n2",
        "Note: Note 2",
      ].join("\n"),
    )
    const settled = DesignRounds.apply(
      round,
      [
        { feedback, index: 1, status: "accepted", reason: "Kept" },
        { feedback, index: 2, status: "unresolved", reason: "Later" },
      ],
      [],
    )
    if ("problem" in settled) throw new Error(settled.problem)
    expect(DesignRounds.recite({ ...round, notes: settled.notes })).toBe("")
    expect(DesignRounds.recite({ rounds: undefined, notes: undefined })).toBe("")
  })

  test("the continuation names what the round still misses, then the notes, and is undefined once every note has an outcome", () => {
    const round = opened(2)
    const document = { ...round, id: designID, revision: "rev_1" }
    expect(DesignRounds.continuation(document, [])).toBe(
      [
        "Design design_checkout: the feedback round is not finished. You stopped while 2 notes still have no recorded outcome.",
        "Still missing: an addressed mark or an outcome for 2 notes of round 1; the design_preview publish that answers round 1; a verify of the current revision for round 1 (design_export format verify with round set; wait for its native monitor); an outcome for 2 notes (design_document update notes).",
        DesignRounds.recite(round),
        "Continue now: fix the notes, mark each addressed, publish one revision, run one verify per round and record each note's outcome; unresolved or accepted with a reason are allowed for a note you will not change. Then reply to the reviewer with the outcomes. This reminder is sent once per round.",
      ].join("\n"),
    )
    // Marked, answered and verified: only the outcomes are left.
    const marked = DesignRounds.tick(
      round,
      [1, 2].map((index) => ({ feedback, index, summary: "Done" })),
    )
    const answered = {
      ...DesignRounds.published({ ...round, notes: marked.notes }, "rev_2"),
      id: designID,
      revision: "rev_2",
    }
    const verified = [job("render_1", "rev_2", 1, [seen(feedback, 1, true), seen(feedback, 2, true)])]
    expect(DesignRounds.continuation(answered, verified)).toContain(
      "Still missing: an outcome for 2 notes (design_document update notes).",
    )
    // A verify of an older revision does not count.
    expect(DesignRounds.continuation({ ...answered, revision: "rev_3" }, verified)).toContain(
      "a verify of the current revision for round 1",
    )
    const settled = DesignRounds.apply(
      answered,
      [
        { feedback, index: 1, status: "accepted", reason: "Kept" },
        { feedback, index: 2, status: "unresolved", reason: "Later" },
      ],
      [],
    )
    if ("problem" in settled) throw new Error(settled.problem)
    expect(DesignRounds.continuation({ ...answered, notes: settled.notes }, verified)).toBeUndefined()
  })
})

describe("DesignVerify", () => {
  const web = [
    { width: 390, height: 900 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]
  const phones = [
    { width: 393, height: 852, device: "ios" as const },
    { width: 412, height: 915, device: "android" as const },
  ]
  const taken = (extra: Partial<Design.FeedbackItem> = {}) => ({ item: { target: "#cta", text: "Bigger", ...extra } })
  const widths = (plan: ReturnType<typeof DesignVerify.placements>) =>
    plan.placements.map((item) => [DesignVerify.viewportLabel(item.viewport), item.notes])

  test("notes are grouped by the viewport they were taken at; a note without one keeps the widest", () => {
    const plan = DesignVerify.placements([taken({ width: 390 }), taken(), taken({ width: 390 }), taken({ width: 1187 })], web)
    // An unconfigured width is used as recorded, at the nearest viewport's height.
    expect(widths(plan)).toEqual([
      ["390px", [0, 2]],
      ["1187px", [3]],
      ["1440px", [1]],
    ])
    expect(plan.placements[1].viewport).toEqual({ width: 1187, height: 900 })
    expect(plan.collapsed).toEqual([])
    // A width no screen has is clamped to one.
    expect(widths(DesignVerify.placements([taken({ width: 100 }), taken({ width: 9000 })], web))).toEqual([
      ["240px", [0]],
      ["3840px", [1]],
    ])
  })

  test("past the cap the least used viewports collapse into the nearest kept one, and say so", () => {
    const plan = DesignVerify.placements(
      [taken({ width: 390 }), taken({ width: 390 }), taken({ width: 768 }), taken({ width: 1440 }), taken({ width: 800 })],
      web,
      3,
    )
    // One note each at 768, 800 and 1440: the wider ones are kept and 768 joins 800.
    expect(widths(plan)).toEqual([
      ["390px", [0, 1]],
      ["800px", [2, 4]],
      ["1440px", [3]],
    ])
    expect(DesignVerify.collapsedFindings(plan.collapsed, 3)).toEqual([
      "review · 1 note taken at 768px verified at 800px: one verify renders at most 3 viewports",
    ])
  })

  test("an app note is verified on the phone it was taken on, the widest phone without one", () => {
    const plan = DesignVerify.placements([taken({ platform: "ios", width: 393 }), taken(), taken({ width: 400 })], phones)
    // A width without a phone picks the phone nearest to it.
    expect(widths(plan)).toEqual([
      ["393px iOS", [0, 2]],
      ["412px Android", [1]],
    ])
    // A single phone takes every note, whatever it recorded.
    expect(widths(DesignVerify.placements([taken({ platform: "android" })], [phones[0]]))).toEqual([["393px iOS", [0]]])
  })

  test("the delta compares the element's text, markup, box and pixels; the same facts twice is no change", () => {
    const facts = { rect: { x: 10, y: 20, width: 100, height: 40 }, text: "Salvar", markup: "a1" }
    const none = DesignVerify.delta(facts, facts)
    expect(none).toEqual({ changed: false, text: false, markup: false, moved: false, resized: false })
    expect(DesignVerify.describe(none)).toBe(
      "change: none to the element (pixels, text, markup, style, position and size are the same)",
    )
    // Sub-pixel layout and anti-aliasing noise are not a change.
    expect(
      DesignVerify.delta(facts, { ...facts, rect: { x: 11, y: 21, width: 101, height: 40 } }, 0.05).changed,
    ).toBe(false)
    const edited = DesignVerify.delta(
      facts,
      { rect: { x: 10, y: 60, width: 160, height: 40 }, text: "保存する", markup: "b2" },
      12.346,
    )
    expect(edited).toEqual({
      changed: true,
      pixels: 12.35,
      text: true,
      markup: true,
      moved: true,
      resized: true,
      textBefore: "Salvar",
      textAfter: "保存する",
    })
    expect(DesignVerify.describe(edited)).toBe("change: 12.35% of pixels, text, markup or style, moved, resized")
    expect(DesignVerify.delta(facts, facts, 3).changed).toBe(true)
    // Not located on the note's own revision: unknown, neither a change nor its absence.
    const unknown = DesignVerify.delta(undefined, facts)
    expect(unknown).toEqual({ changed: false, known: false, text: false, markup: false, moved: false, resized: false })
    expect(DesignVerify.unmeasured(unknown)).toBe(true)
    expect(DesignVerify.unmeasured(none)).toBe(false)
    // An earlier verify's `added` reads the same way.
    expect(DesignVerify.unmeasured({ ...none, changed: true, added: true })).toBe(true)
    expect(DesignVerify.describe(unknown)).toBe(
      "change: could not be measured (the element was not located on the revision the note was taken on), so this is no evidence of a change",
    )
    // Quoted text is clipped to the schema's bound without splitting a character.
    const long = DesignVerify.delta(facts, { ...facts, text: "😀".repeat(300) }).textAfter!
    expect(long.length).toBeLessThanOrEqual(240)
    expect(long).toBe(`${"😀".repeat(119)}…`)
  })

  test("resolved is refused when the verify saw no change in the note's element; partial and the rest are not", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#cta", "Bigger"), note("#title", "Say hello")]),
      100,
    )
    const answered = { ...DesignRounds.published(opened, "rev_2"), revision: "rev_2" }
    const facts = { rect: { x: 0, y: 0, width: 100, height: 40 }, text: "Go", markup: "a" }
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true, { width: 390, delta: DesignVerify.delta(facts, facts, 0) }),
      seen("msg_1", 2, true, { delta: DesignVerify.delta(facts, { ...facts, text: "Hello" }) }),
    ])
    const feedback = SessionMessage.ID.make("msg_1")
    const gate = (update: Design.NoteUpdate) => DesignRounds.triage(answered, [update], [verify]).checked[0].refusal
    const cite = { evidence: { job: "render_1" } }
    expect(gate({ feedback, index: 1, status: "resolved", ...cite })).toBe(
      `${DesignRounds.REFUSED} msg_1 #1 cannot be resolved: render_1 saw no change to its element since the revision the note was taken on (pixels, text, markup, style, position and size are the same at 390px). Change the element the note names, publish and verify again; for a behavior a capture cannot show (hover, focus, a script), add or update a scenario on the note's screen that acts on its element, publish and verify again; or record it unresolved or accepted with a reason saying why it stays as it is.`,
    )
    expect(gate({ feedback, index: 2, status: "resolved", ...cite })).toBeUndefined()
    expect(gate({ feedback, index: 1, status: "partial", reason: "Only the color changed", ...cite })).toBeUndefined()
    expect(gate({ feedback, index: 1, status: "accepted", reason: "Stays as designed" })).toBeUndefined()
    expect(gate({ feedback, index: 1, status: "unresolved", reason: "Not this round", ...cite })).toBeUndefined()
    // A verify that measured no delta (the earlier revision could not render) refuses nothing new.
    const unmeasured = job("render_2", "rev_2", 1, [seen("msg_1", 1, true)])
    expect(
      DesignRounds.triage(answered, [{ feedback, index: 1, status: "resolved", evidence: { job: "render_2" } }], [unmeasured])
        .checked[0].refusal,
    ).toBeUndefined()
  })

  test("a claimed fix shows a review the addressed mark, where the note was taken and the delta", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#cta", "Bigger"), note("#other", "Other")]),
      100,
    )
    const marked = DesignRounds.tick(opened, [{ feedback: "msg_1", index: 1, summary: "Raised the font size" }], 200)
    const withViewport = {
      ...opened,
      notes: marked.notes.map((item) =>
        item.index === 1 ? { ...item, item: { ...item.item, width: 390, platform: undefined } } : item,
      ),
    }
    const facts = { rect: { x: 0, y: 0, width: 100, height: 40 }, text: "Go", markup: "a" }
    const delta = DesignVerify.delta(facts, { ...facts, rect: { ...facts.rect, height: 56 }, markup: "b" }, 30)
    const verify = job("render_1", "rev_2", 1, [seen("msg_1", 1, true, { width: 390, delta }), seen("msg_1", 2, true)])
    const feedback = SessionMessage.ID.make("msg_1")
    expect(
      DesignRounds.claim(withViewport, { feedback, index: 1, status: "resolved", evidence: { job: "render_1" } }, [verify])
        .change,
    ).toEqual({
      addressed: "Raised the font size",
      taken: { width: 390, platform: undefined },
      verified: { width: 390, platform: undefined },
      delta,
    })
    // Neither a mark nor a delta: nothing about a change to show.
    expect(
      DesignRounds.claim(withViewport, { feedback, index: 2, status: "resolved", evidence: { job: "render_1" } }, [verify])
        .change,
    ).toBeUndefined()
  })

  test("an unmeasured delta, a behavior verified by a scenario and a page-level note pass the change gate on a clean verify", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [
        note("#cta", "Bigger"),
        note("#menu", "Open on hover"),
        note("variant:stone page", "Calmer overall"),
        note("#title", "Say hello"),
      ]),
      100,
    )
    const answered = { ...DesignRounds.published(opened, "rev_2"), revision: "rev_2" }
    const facts = { rect: { x: 0, y: 0, width: 100, height: 40 }, text: "Go", markup: "a" }
    const same = DesignVerify.delta(facts, facts, 0)
    const unknown = DesignVerify.delta(undefined, facts)
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true, { delta: unknown }),
      seen("msg_1", 2, true, { delta: same, scenarios: ["Hover menu: exercised"], exercised: ["Hover menu"] }),
      // A page-level note from a verify that still measured it: the gate does not read that delta.
      seen("msg_1", 3, true, { delta: same }),
      // A scenario ran on the screen but did not act on this element: a plain visual note is still refused.
      seen("msg_1", 4, true, { delta: same, scenarios: ["Submit: exercised"] }),
    ])
    const feedback = SessionMessage.ID.make("msg_1")
    const gate = (update: Design.NoteUpdate, jobs = [verify]) => DesignRounds.triage(answered, [update], jobs).checked[0].refusal
    const resolved = (index: number) => ({ feedback, index, status: "resolved" as const, evidence: { job: "render_1" } })
    expect(gate(resolved(1))).toBeUndefined()
    expect(gate(resolved(2))).toBeUndefined()
    expect(gate(resolved(3))).toBeUndefined()
    expect(gate(resolved(4))).toContain("saw no change to its element")
    // Each still needs a completed verify that found the element without a blocking finding.
    expect(gate({ feedback, index: 3, status: "resolved" })).toContain("needs evidence: run one verify")
    expect(gate(resolved(3), [job("render_1", "rev_2", 1, verify.verify.notes, "running")])).toContain(
      "is not a completed verify job",
    )
    const blocked = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true, { delta: unknown, blocking: true, findings: ["error · script error: boom"] }),
      seen("msg_1", 2, false, { exercised: ["Hover menu"] }),
    ])
    expect(gate(resolved(1), [blocked])).toContain("found blocking findings for it (error · script error: boom)")
    expect(gate(resolved(2), [blocked])).toContain("did not find its element")
    // Partial, accepted and unresolved are untouched.
    expect(gate({ ...resolved(4), status: "partial", reason: "Only the color" })).toBeUndefined()
    expect(gate({ feedback, index: 4, status: "accepted", reason: "Stays" })).toBeUndefined()
  })

  test("a review is told an unmeasured change in words and which scenarios verified a behavior", () => {
    const opened = DesignRounds.admit(
      { rounds: undefined, notes: undefined },
      message("msg_1", "rev_1", [note("#cta", "Bigger"), note("#menu", "Open on hover")]),
      100,
    )
    const facts = { rect: { x: 0, y: 0, width: 100, height: 40 }, text: "Go", markup: "a" }
    const verify = job("render_1", "rev_2", 1, [
      seen("msg_1", 1, true, { delta: DesignVerify.delta(undefined, facts) }),
      seen("msg_1", 2, true, { delta: DesignVerify.delta(facts, facts), exercised: ["Hover menu"] }),
    ])
    const feedback = SessionMessage.ID.make("msg_1")
    const shown = (index: number) =>
      DesignRounds.claim(opened, { feedback, index, status: "resolved", evidence: { job: "render_1" } }, [verify])
    expect(shown(1).change?.unmeasured).toBe(DesignVerify.describe(DesignVerify.delta(undefined, facts)))
    expect(shown(1).observation?.exercised).toBeUndefined()
    expect(shown(2).change?.unmeasured).toBeUndefined()
    expect(shown(2).observation?.exercised).toEqual(["Hover menu"])
  })

  test("near widths share one viewport, a width near a configured one takes it, and breakpoint neighbours stay apart", () => {
    const plan = DesignVerify.placements(
      [taken({ width: 1187 }), taken({ width: 1210 }), taken({ width: 1210 }), taken({ width: 393 }), taken({ width: 768 })],
      web,
    )
    // 1187 and 1210 share the width most of their notes recorded; 393 is the configured 390.
    expect(widths(plan)).toEqual([
      ["390px", [3]],
      ["768px", [4]],
      ["1210px", [0, 1, 2]],
    ])
    expect(plan.collapsed).toEqual([])
    // 800 is 4% from 768, past the tolerance: a breakpoint may lie between them, so each keeps its own.
    expect(widths(DesignVerify.placements([taken({ width: 768 }), taken({ width: 800 })], web))).toEqual([
      ["768px", [0]],
      ["800px", [1]],
    ])
    // A tie keeps the wider width.
    expect(widths(DesignVerify.placements([taken({ width: 1187 }), taken({ width: 1210 })], web))).toEqual([
      ["1210px", [0, 1]],
    ])
  })

  test("a note's reason says where it was verified when that is not where it was taken", () => {
    const at = (width: number, device?: "ios" | "android") => ({ width, height: 900, ...(device ? { device } : {}) })
    expect(DesignVerify.displaced({ width: 1187 }, at(1210))).toBe(
      "verified at 1210px, not at 1187px where the note was taken",
    )
    expect(DesignVerify.displaced({ width: 1210 }, at(1210))).toBe("")
    expect(DesignVerify.displaced({}, at(1440))).toBe("")
    expect(DesignVerify.displaced({ width: 393, platform: "ios" }, at(412, "android"))).toBe(
      "verified at 412px Android, not at 393px iOS where the note was taken",
    )
    const facts = { rect: { x: 0, y: 0, width: 100, height: 40 }, text: "Go", markup: "a" }
    expect(
      DesignVerify.remarks({
        item: { target: "#menu", width: 800 },
        viewport: at(768),
        found: true,
        delta: DesignVerify.delta(facts, facts),
        exercised: ["Hover menu"],
      }),
    ).toEqual([
      "change: none to the element (pixels, text, markup, style, position and size are the same)",
      "behavior verified by scenario Hover menu",
      "verified at 768px, not at 800px where the note was taken",
    ])
    expect(DesignVerify.remarks({ item: { target: "variant:stone page" }, viewport: at(1440), found: true })).toEqual([
      "change: not measured for a page-level note (the whole page is not compared as one element)",
    ])
    // A missing element reports no change, only where it was looked for.
    expect(
      DesignVerify.remarks({ item: { target: "#cta", width: 9000 }, viewport: at(3840), found: false, exercised: ["X"] }),
    ).toEqual(["verified at 3840px, not at 9000px where the note was taken"])
    expect(DesignVerify.isPage("page")).toBe(true)
    expect(DesignVerify.isPage("#page")).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import {
  announcedOrdinals,
  designRoundSummary,
  outcomeTally,
  revisionOrdinal,
  type NoteShape,
} from "./design-round-summary.js"

const note = (round: number, status: NoteShape["status"], extra: Partial<NoteShape> = {}): NoteShape => ({
  round,
  status,
  ...extra,
})
// Newest first, as the server lists them: rev_3 is R3.
const revisions = [{ id: "rev_3" }, { id: "rev_2" }, { id: "rev_1" }]

describe("designRoundSummary", () => {
  test("names each stage from the document alone", () => {
    const stage = (published: string | undefined, notes: NoteShape[]) =>
      designRoundSummary({
        revision: "rev_1",
        rounds: [{ number: 1, revision: "rev_1", ...(published ? { published } : {}) }],
        notes,
      }).latest?.stage
    expect(stage(undefined, [note(1, "open")])).toBe("received")
    expect(stage(undefined, [note(1, "open", { addressed: { summary: "done", at: 1 } }), note(1, "open")])).toBe(
      "fixing",
    )
    expect(stage("rev_2", [note(1, "resolved"), note(1, "open")])).toBe("published")
    expect(stage("rev_2", [note(1, "resolved"), note(1, "accepted")])).toBe("recorded")
  })

  test("counts outcomes and keeps a finished round with partial and unresolved notes visible", () => {
    const summary = designRoundSummary(
      {
        revision: "rev_3",
        rounds: [
          { number: 1, revision: "rev_1", published: "rev_2" },
          { number: 2, revision: "rev_2", published: "rev_3" },
        ],
        notes: [
          note(1, "resolved"),
          note(2, "resolved"),
          note(2, "resolved"),
          note(2, "partial"),
          note(2, "unresolved"),
          note(2, "accepted", { by: "reviewer" }),
        ],
      },
      revisions,
    )
    expect(summary.pending).toEqual([])
    expect(summary.open).toBe(0)
    expect(summary.answered?.number).toBe(2)
    expect(summary.answered).toMatchObject({
      total: 5,
      open: 0,
      recorded: 5,
      resolved: 2,
      partial: 1,
      unresolved: 1,
      accepted: 1,
      reviewer: 1,
      opened: { id: "rev_2", ordinal: 2 },
      published: { id: "rev_3", ordinal: 3 },
    })
    expect(outcomeTally(summary.answered!)).toBe("2 resolved · 1 partial · 1 unresolved · 1 accepted")
    expect(summary.revision).toEqual({ id: "rev_3", ordinal: 3 })
  })

  test("lists rounds with open notes newest first and has no answered round while the newest is open", () => {
    const summary = designRoundSummary({
      revision: "rev_2",
      rounds: [
        { number: 1, revision: "rev_1", published: "rev_2" },
        { number: 2, revision: "rev_2" },
      ],
      notes: [note(1, "open"), note(1, "resolved"), note(2, "open", { addressed: true }), note(2, "open")],
    })
    expect(summary.pending.map((round) => round.number)).toEqual([2, 1])
    expect(summary.pending[0]).toMatchObject({ open: 2, addressed: 1, recorded: 0 })
    expect(summary.answered).toBeUndefined()
    expect(summary.open).toBe(3)
    // Without a revision list the ordinal is unknown.
    expect(summary.revision).toEqual({ id: "rev_2", ordinal: 0 })
  })

  test("reports a pending end only while the review is open", () => {
    const base = { revision: "rev_1", rounds: [], notes: [] }
    expect(designRoundSummary({ ...base, endRequested: true }).endRequested).toBe(true)
    expect(designRoundSummary({ ...base, endRequested: true, ended: true })).toMatchObject({
      endRequested: false,
      ended: true,
    })
    expect(designRoundSummary(base)).toMatchObject({ endRequested: false, ended: false, latest: undefined })
    expect(designRoundSummary({ revision: null }).revision).toBeUndefined()
  })
})

describe("revisionOrdinal", () => {
  test("counts from the oldest revision", () => {
    expect(revisionOrdinal(revisions, "rev_3")).toBe(3)
    expect(revisionOrdinal(revisions, "rev_1")).toBe(1)
    expect(revisionOrdinal(revisions, "rev_9")).toBe(0)
  })
})

describe("announcedOrdinals", () => {
  test("reads completed design_preview and design_history results", () => {
    const tool = (name: string, status: string, metadata?: Record<string, unknown>) => ({
      name,
      state: { status, metadata },
    })
    const ordinals = announcedOrdinals([
      tool("design_preview", "completed", { designID: "design_a", revision: "rev_1", ordinal: 1 }),
      tool("design_history", "completed", { designID: "design_a", revision: "rev_2", ordinal: 2 }),
      tool("design_preview", "running", { revision: "rev_3", ordinal: 3 }),
      tool("design_preview", "completed", { revision: "rev_4", ordinal: "4" }),
      tool("read", "completed", { revision: "rev_5", ordinal: 5 }),
    ])
    expect([...ordinals]).toEqual([
      ["rev_1", 1],
      ["rev_2", 2],
    ])
  })
})

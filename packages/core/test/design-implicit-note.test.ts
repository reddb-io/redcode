import { describe, expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignApproval } from "@opencode/core/design/approval"
import { DesignRounds } from "@opencode/core/design/rounds"

const typed = {
  id: "msg_typed_change",
  text: "Make the header bigger and fix the colors.\nKeep the footer exactly as it is, including the small print.",
}
const review: Design.Feedback = {
  id: SessionMessage.ID.make("msg_review"),
  revision: "rev_1",
  text: "",
  items: [{ target: "#title", text: "Larger title", label: "h1" }],
  assets: [],
  snapshot: "",
  delivery: "steer",
  end: false,
}
const empty = { revision: "rev_1", rounds: undefined, notes: undefined }

describe("DesignRounds.implicit", () => {
  test("opens a round on the published revision with one page note that keeps the user's words whole", () => {
    const admitted = DesignRounds.implicit(empty, typed, 5)
    expect(admitted.rounds).toEqual([{ number: 1, opened: 5, revision: "rev_1", feedback: [typed.id] }])
    expect(admitted.notes).toEqual([
      {
        feedback: typed.id,
        index: 1,
        round: 1,
        item: { target: DesignRounds.PAGE, text: typed.text, revision: "rev_1" },
        status: "open",
        source: "message",
        updated: 5,
      },
    ])
  })

  test("joins the open round, and opens the next one once a revision answered it", () => {
    const open = DesignRounds.admit(empty, review, 1)
    const joined = DesignRounds.implicit({ ...open, revision: "rev_1" }, typed, 2)
    expect(joined.rounds).toEqual([{ number: 1, opened: 1, revision: "rev_1", feedback: [review.id, typed.id] }])
    expect(joined.notes?.map((note) => [note.feedback, note.round])).toEqual([
      [review.id, 1],
      [typed.id, 1],
    ])
    const answered = DesignRounds.published(open, "rev_2")
    const next = DesignRounds.implicit({ ...answered, revision: "rev_2" }, typed, 3)
    expect(next.rounds?.at(-1)).toEqual({ number: 2, opened: 3, revision: "rev_2", feedback: [typed.id] })
  })

  test("takes the note on the revision the message arrived on, even after the agent published again", () => {
    const answered = { ...DesignRounds.published(DesignRounds.admit(empty, review, 1), "rev_2"), revision: "rev_2" }
    const late = DesignRounds.implicit(answered, { ...typed, revision: "rev_1" }, 4)
    expect(late.rounds?.at(-1)).toEqual({ number: 2, opened: 4, revision: "rev_1", feedback: [typed.id] })
    expect(late.notes?.at(-1)?.item.revision).toBe("rev_1")
    expect(DesignRounds.implicit(answered, typed, 4).notes?.at(-1)?.item.revision).toBe("rev_2")
  })

  test("records one note per message, and none for a blank message or an unpublished design", () => {
    const once = { ...DesignRounds.implicit(empty, typed, 1), revision: "rev_1" }
    expect(DesignRounds.implicit(once, typed, 2)).toBe(once)
    // A review message admitted under the same id is never doubled by its classification.
    const reviewed = { ...DesignRounds.admit(empty, review, 1), revision: "rev_1" }
    expect(DesignRounds.implicit(reviewed, { id: review.id, text: "Larger title" })).toBe(reviewed)
    expect(DesignRounds.implicit(empty, { id: "msg_blank", text: " \n " })).toBe(empty)
    const unpublished = { revision: null, rounds: undefined, notes: undefined }
    expect(DesignRounds.implicit(unpublished, typed)).toBe(unpublished)
  })

  test("blocks publish, approval and the end of the review like a note from the review page", () => {
    const document = { id: Design.ID.make("design_checkout"), ...DesignRounds.implicit(empty, typed, 1) }
    expect(DesignRounds.unanswerable(document)).toContain(`${typed.id} #1 [open] page (from a chat message)`)
    const blocking = DesignRounds.blocking(document)
    expect(blocking).toContain("Round 1 has 1 note without a recorded outcome")
    expect(blocking).toContain(typed.text.split("\n")[1])
    expect(DesignRounds.recite(document)).toContain("page (from a chat message)")
    expect(DesignRounds.continuation({ ...document, revision: "rev_1" }, [])).toContain(`${typed.id} #1`)
  })

  test("design_read names the note's origin", () => {
    const document = { id: Design.ID.make("design_checkout"), ...DesignRounds.implicit(empty, typed, 1) }
    const read = DesignApproval.notes(document, { note: 1, feedback: typed.id })
    expect("text" in read ? read.text : read.problem).toContain("Source: a chat message the user typed")
  })
})

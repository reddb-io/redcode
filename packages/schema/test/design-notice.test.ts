import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Design } from "../src/design.js"
import { DesignNotice } from "../src/design-notice.js"
import { SessionMessage } from "../src/session-message.js"

const checkout = Design.ID.make("design_checkout")

const review = [
  '<design-review id="design_checkout" revision="rev_1" feedback="msg_review" variant="stone" ended="true">',
  "## Message",
  "Looks close",
  "    and nearly done.",
  "",
  "## Notes (2)",
  '### 1. h1 "Checkout" — main > h1',
  "Note: Make this title more prominent",
  "Context: header",
  "",
  "### 2. page",
  "Note: Add a footer",
  "",
  "## Attachments",
  "- image 1: reference.png (attached as a file)",
  "",
  "## Next step",
  'A page-text snapshot was captured; fetch it with design_read {"id":"design_checkout","section":"snapshot","feedback":"msg_review"} if you need page context.',
  "</design-review>",
].join("\n")

describe("DesignNotice.feedback", () => {
  test("recovers the compact card from a rendered review", () => {
    expect(DesignNotice.feedback(review)).toEqual({
      id: checkout,
      feedback: SessionMessage.ID.make("msg_review"),
      revision: "rev_1",
      variant: "stone",
      ended: true,
      text: "Looks close\nand nearly done.",
      notes: [
        { label: 'h1 "Checkout" — main > h1', text: "Make this title more prominent" },
        { label: "page", text: "Add a footer" },
      ],
      sent: 2,
      attachments: ["reference.png"],
      snapshot: true,
    })
  })

  test("reads the round and the lines that say what a long message left out", () => {
    const notice = DesignNotice.feedback(
      [
        '<design-review id="design_checkout" revision="rev_1" feedback="msg_review" variant="stone" ended="false">',
        DesignNotice.notesHeading(2),
        DesignNotice.notesSummary(2, 9),
        'Backup locators (Context, XPath, Parent) left out to fit; one note in full: design_read {"id":"design_checkout","section":"notes","feedback":"msg_review","note":<n>}',
        "",
        DesignNotice.noteHeading(1, 'button[data-design-id="pay"] "Pay"'),
        "Note: Round 3: this label is wrong",
        "    Round 4: so is this one",
        'Selected text: "Pay now…" (+1760 more characters; whole note: design_read {"id":"design_checkout","section":"notes","feedback":"msg_review","note":1})',
        "",
        DesignNotice.noteHeading(2, "svg in button — button > svg:nth-of-type(1)"),
        "Note: Bigger",
        "",
        "## Next step",
        "Feedback round 2: fix everything in this round.",
        "</design-review>",
      ].join("\n"),
    )
    expect(notice).toMatchObject({
      notes: [
        { label: 'button[data-design-id="pay"] "Pay"', text: "Round 3: this label is wrong\nRound 4: so is this one" },
        { label: "svg in button — button > svg:nth-of-type(1)", text: "Bigger" },
      ],
      sent: 2,
      // The line under the heading names the round; the next step is only read when it is missing.
      round: 9,
    })
    expect(Schema.is(Design.FeedbackNotice)(notice)).toBe(true)
    expect(DesignNotice.notesSummary(1, 9)).toBe("Round 9: 1 note, all listed below.")
    expect(DesignNotice.notesSummary(14)).toBe("14 notes, all listed below.")
  })

  test("a message cut short by an older renderer reports fewer notes than it was sent with", () => {
    const notice = DesignNotice.feedback(
      [
        '<design-review id="design_checkout" revision="rev_1" feedback="msg_review" variant="stone" ended="false">',
        "## Notes (14)",
        "",
        '### 1. h1 "Checkout" — main > h1',
        "Note: Make this title more prominent",
        "Context: header",
        "",
        "### 2. page",
        "Note: Add a foo",
        "[Truncated: 3487 characters omitted; the full notes are stored with feedback msg_review.]",
        "",
        "## Next step",
        "Feedback round 9: fix everything in this round, publish one revision with design_preview.",
        "</design-review>",
      ].join("\n"),
    )
    expect(notice?.notes).toEqual([
      { label: 'h1 "Checkout" — main > h1', text: "Make this title more prominent" },
      { label: "page", text: "Add a foo" },
    ])
    expect(notice).toMatchObject({ sent: 14, round: 9 })
  })

  test("a message without notes names no count and no round", () => {
    const notice = DesignNotice.feedback(
      [
        '<design-review id="design_checkout" revision="rev_1" feedback="msg_review" ended="false">',
        "## Message",
        "Round 5: looks good",
        "    ## Notes (3)",
        "",
        "## Next step",
        "Publish one revision with design_preview.",
        "</design-review>",
      ].join("\n"),
    )
    expect(notice).toMatchObject({ text: "Round 5: looks good\n## Notes (3)", notes: [] })
    expect(notice).not.toHaveProperty("sent")
    expect(notice).not.toHaveProperty("round")
  })

  test("a heading on the first line of the Message is the user's text, not a section", () => {
    // The first line of the Message is not indented: it sits at column 0 directly under its heading.
    const parse = (message: string[], rest: string[]) =>
      DesignNotice.feedback(
        [
          '<design-review id="design_checkout" revision="rev_1" feedback="msg_review" ended="false">',
          "## Message",
          ...message,
          "",
          ...rest,
          "</design-review>",
        ].join("\n"),
      )
    const notes = [
      DesignNotice.notesHeading(2),
      DesignNotice.notesSummary(2, 4),
      "",
      DesignNotice.noteHeading(1, "#a"),
      "Note: First",
      "",
      DesignNotice.noteHeading(2, "#b"),
      "Note: Second",
      "",
    ]
    const next = ["## Next step", "Publish one revision with design_preview."]

    // Without notes there is no count to report, whatever the message opens with.
    const alone = parse(["## Notes (7)", "    please fix all"], next)
    expect(alone).toMatchObject({ text: "## Notes (7)\nplease fix all", notes: [] })
    expect(alone).not.toHaveProperty("sent")
    expect(alone).not.toHaveProperty("round")

    // With notes, the count and the list are those of the real heading.
    for (const message of [["## Notes (7)", "    please fix all"], ["## Notes (7)"]]) {
      const notice = parse(message, [...notes, ...next])
      expect(notice).toMatchObject({
        notes: [
          { label: "#a", text: "First" },
          { label: "#b", text: "Second" },
        ],
        round: 4,
      })
      expect(notice?.text).toStartWith("## Notes (7)")
      expect(notice?.sent).toBe(notice?.notes.length)
    }

    // The other sections are not shadowed either.
    expect(
      parse(
        ["## Attachments", "    see the png"],
        ["## Attachments", "- image 1: shot.png (attached as a file)", "", ...next],
      ),
    ).toMatchObject({ text: "## Attachments\nsee the png", attachments: ["shot.png"] })
    // A message rendered before the notes summary existed names its round only in the next step.
    expect(
      parse(
        ["## Next step", "    Feedback round 12: none"],
        [
          "## Notes (1)",
          "",
          "### 1. #a",
          "Note: First",
          "",
          "## Next step",
          "Feedback round 9: fix everything in this round.",
        ],
      ),
    ).toMatchObject({ notes: [{ label: "#a", text: "First" }], sent: 1, round: 9 })
  })

  test("names a variant operation", () => {
    const notice = DesignNotice.feedback(
      [
        '<design-review id="design_checkout" revision="rev_2" feedback="msg_merge" ended="false">',
        "## Variant operation",
        "Operation: merge Spacious + Compact",
        "Kind: merge",
        "</design-review>",
      ].join("\n"),
    )
    expect(notice).toMatchObject({ operation: "merge Spacious + Compact", variant: null, ended: false, notes: [] })
  })

  test("ignores any other prompt", () => {
    expect(DesignNotice.feedback("Please review the checkout page")).toBeUndefined()
    expect(
      DesignNotice.feedback('<design-review id="checkout" revision="r" feedback="msg_a" ended="false">'),
    ).toBeUndefined()
  })
})

describe("DesignNotice.approval", () => {
  const metadata = { source: "design.approval", designID: "design_checkout", revision: "rev_4" }

  test("reads the approved variant from the handoff message", () => {
    expect(
      DesignNotice.approval({
        text: "Design Checkout, revision rev_4, variant Stone (stone), approved. Continue in Plan.\n\nDesign plan: /tmp/plan.md",
        metadata,
      }),
    ).toEqual({ id: checkout, name: "Checkout", revision: "rev_4", variant: { id: "stone", name: "Stone" } })
  })

  test("an approval of the entire revision has no variant, and a comma in the name stays in the name", () => {
    expect(
      DesignNotice.approval({ text: "Design Checkout, mobile, revision rev_4, approved. Continue in Plan.", metadata }),
    ).toEqual({ id: checkout, name: "Checkout, mobile", revision: "rev_4", variant: null })
  })

  test("reads back the line the handoff writes", () => {
    for (const variant of [null, { id: "stone", name: "Stone, warm" }])
      expect(
        DesignNotice.approval({
          text: `${DesignNotice.approvalLine({ name: "Checkout, mobile", revision: "rev_4", variant })}\n\nDesign plan: /tmp/plan.md`,
          metadata,
        }),
      ).toEqual({ id: checkout, name: "Checkout, mobile", revision: "rev_4", variant })
  })

  test("ignores other synthetic messages and malformed handoffs", () => {
    expect(
      DesignNotice.approval({ text: "Design Checkout, revision rev_4, approved. Continue in Plan." }),
    ).toBeUndefined()
    expect(
      DesignNotice.approval({ text: "Shell finished", metadata: { ...metadata, source: "shell" } }),
    ).toBeUndefined()
    expect(
      DesignNotice.approval({ text: "Design Checkout, revision rev_5, approved. Continue in Plan.", metadata }),
    ).toBeUndefined()
  })
})

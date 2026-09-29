import { describe, expect, test } from "bun:test"
import { DesignNotice } from "../src/design-notice.js"

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
      id: "design_checkout",
      feedback: "msg_review",
      revision: "rev_1",
      variant: "stone",
      ended: true,
      text: "Looks close\nand nearly done.",
      notes: [
        { label: 'h1 "Checkout" — main > h1', text: "Make this title more prominent" },
        { label: "page", text: "Add a footer" },
      ],
      attachments: ["reference.png"],
      snapshot: true,
    })
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
    ).toEqual({ id: "design_checkout", name: "Checkout", revision: "rev_4", variant: { id: "stone", name: "Stone" } })
  })

  test("an approval of the entire revision has no variant, and a comma in the name stays in the name", () => {
    expect(
      DesignNotice.approval({ text: "Design Checkout, mobile, revision rev_4, approved. Continue in Plan.", metadata }),
    ).toEqual({ id: "design_checkout", name: "Checkout, mobile", revision: "rev_4", variant: null })
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

/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DesignFeedbackNotice } from "../../src/component/design-feedback"
import { mountDialog } from "../fixture/dialog"
import { wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"

test("compact Design review lists the notes and attachments without the rendered message", async () => {
  await using tmp = await tmpdir()
  function Notice() {
    return (
      <>
        <DesignFeedbackNotice
          value={{
            id: "design_checkout",
            feedback: "msg_review",
            revision: "rev_1",
            variant: "stone",
            ended: true,
            text: "Looks close",
            notes: [
              { label: 'h1 "Checkout"', text: "Make this title more prominent" },
              { label: "page", text: "Add a footer" },
            ],
            attachments: ["reference.png"],
            snapshot: true,
          }}
        />
        <DesignFeedbackNotice value={{ id: "design_checkout", notes: "MALFORMED REVIEW" }} />
        <input id="prompt" placeholder="Continue the conversation" focused />
      </>
    )
  }
  const setup = await mountDialog({ root: tmp.path, children: () => <Notice /> })
  try {
    await wait(() => !!setup.renderer.currentFocusedEditor)
    await setup.renderOnce()
    const screen = setup.captureCharFrame()
    expect(screen).toContain("Design review · design_checkout · rev_1 · stone · ended")
    expect(screen).toContain("Looks close")
    expect(screen).toContain('1. h1 "Checkout" — Make this title more prominent')
    expect(screen).toContain("2. page — Add a footer")
    expect(screen).toContain("reference.png")
    expect(screen).toContain("Page text captured")
    expect(screen).toContain("Continue the conversation")
    expect(screen).not.toContain("<design-review")
    expect(screen).not.toContain("MALFORMED REVIEW")
  } finally {
    setup.renderer.destroy()
  }
})

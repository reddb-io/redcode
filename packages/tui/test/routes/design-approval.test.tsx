/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { DesignApprovalNotice } from "../../src/component/design-approval"
import { useOpencodeKeymap } from "../../src/keymap"
import { mountDialog } from "../fixture/dialog"
import { wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"

test("compact Design approval renders the recorded selection and opens review", async () => {
  await using tmp = await tmpdir()
  const opened: string[] = []
  function Notice() {
    const keymap = useOpencodeKeymap()
    onCleanup(
      keymap.registerLayer({
        commands: [
          {
            name: "session.design.review",
            run: () => {
              opened.push("review")
            },
          },
        ],
      }),
    )
    return (
      <>
        <DesignApprovalNotice
          value={{
            id: "design_checkout",
            name: "Checkout",
            revision: "revision-approved",
            variant: { id: "stone", name: "Stone" },
          }}
        />
        <DesignApprovalNotice value={{ name: "MALFORMED APPROVAL" }} />
        <input id="prompt" placeholder="Continue the conversation" focused />
      </>
    )
  }
  const setup = await mountDialog({ root: tmp.path, children: () => <Notice /> })
  try {
    await wait(() => !!setup.renderer.currentFocusedEditor)
    await setup.renderOnce()
    const screen = setup.captureCharFrame()
    expect(screen).toContain("Design approved")
    expect(screen).toContain("Stone")
    expect(screen).toContain("revision-approved")
    expect(screen).toContain("Continue the conversation")
    expect(screen).not.toContain("MALFORMED APPROVAL")
    const row = screen.split("\n").findIndex((line) => line.includes("Open design and decisions"))
    await setup.mockMouse.click(5, row)
    expect(opened).toEqual(["review"])
    setup.mockInput.typeText("Continue in Plan")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Continue in Plan")
  } finally {
    setup.renderer.destroy()
  }
})

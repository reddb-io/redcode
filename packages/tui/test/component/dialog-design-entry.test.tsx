/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { DialogDesignEntry } from "../../src/component/dialog-design-entry"
import { mountDialog } from "../fixture/dialog"
import { tmpdir } from "../fixture/fixture"
import { wait } from "../cli/cmd/tui/sync-fixture"

test("Design entry copies a new workspace command without a legacy session ID or review URL", async () => {
  await using tmp = await tmpdir()
  const copied: string[] = []
  const app = await mountDialog({
    root: tmp.path,
    clipboard: {
      write: async (text) => {
        copied.push(text)
      },
    },
    children: () => <DialogDesignEntry />,
  })
  try {
    await wait(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Design workspace")
    app.mockInput.pressEnter()
    await wait(() => copied.length > 0)
    expect(copied).toEqual(["redcode design"])
  } finally {
    app.renderer.destroy()
  }
})

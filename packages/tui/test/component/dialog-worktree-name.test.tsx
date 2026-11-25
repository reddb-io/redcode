/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DialogWorktreeName } from "../../src/component/dialog-worktree-name"
import { renderLocal } from "../fixture/local"

test("a worktree name can be generated and submitted from its visible controls", async () => {
  await using app = await renderLocal()
  app.resize(38, 24)
  const result = DialogWorktreeName.show(app.dialog)
  await app.renderOnce()
  const click = async (label: string) => {
    const lines = app.captureCharFrame().split("\n")
    const row = lines.findIndex((line) => line.includes(label))
    expect(row).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(lines[row].indexOf(label), row)
  }
  await click("generate one")
  await app.renderOnce()
  const name = app.renderer.currentFocusedEditor?.plainText ?? ""
  expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  await click("enter submit")
  expect(await result).toBe(name)
})

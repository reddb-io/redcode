/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DialogExportResult } from "../../../src/ui/dialog-export-result"
import { DialogHelp } from "../../../src/ui/dialog-help"
import { renderLocal } from "../../fixture/local"

test.each([36, 100])("export paths remain readable and dismissible at %i columns", async (width) => {
  await using app = await renderLocal()
  app.resize(width, 24)
  const path = "/projects/redcode/exports/example-session-with-a-long-filename.md"
  const closed = DialogExportResult.show(app.dialog, path)
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame.replace(/\s/g, "")).toContain(path)
  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes("Close"))
  expect(row).toBeGreaterThanOrEqual(0)
  await app.mockMouse.click(lines[row].indexOf("Close"), row)
  await closed
  expect(app.dialog.stack).toHaveLength(0)

  app.dialog.replace(() => <DialogHelp />)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("esc/enter")
  app.mockInput.pressEnter()
  await app.renderOnce()
  expect(app.dialog.stack).toHaveLength(0)
})

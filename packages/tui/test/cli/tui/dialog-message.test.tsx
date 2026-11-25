/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DialogExportOptions } from "../../../src/ui/dialog-export-options"
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

test.each([36, 100])("export options keep focus visible across format changes at %i columns", async (width) => {
  await using app = await renderLocal()
  app.resize(width, 30)
  const result = DialogExportOptions.show(app.dialog, true, false, true)
  await app.renderOnce()
  const copyBackground = () =>
    app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("Copy"))!.bg
  const inactive = copyBackground()
  app.mockInput.pressTab()
  app.mockInput.pressEnter()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Sanitize sensitive data")
  expect(app.captureCharFrame()).not.toContain("Include thinking")
  app.mockInput.pressTab()
  app.mockInput.pressEnter()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("[x] Sanitize sensitive data")
  app.mockInput.pressTab()
  await app.renderOnce()
  expect(copyBackground()).not.toEqual(inactive)
  app.mockInput.pressTab()
  await app.renderOnce()
  expect(copyBackground()).toEqual(inactive)
  app.mockInput.pressTab({ shift: true })
  app.mockInput.pressEnter()
  expect(await result).toEqual({
    action: "copy",
    format: "json",
    thinking: true,
    tools: true,
    toolDetails: false,
    assistantMetadata: true,
    sanitize: true,
  })
})

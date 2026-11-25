/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DialogSecret } from "../../src/component/dialog-secret"
import { renderLocal } from "../fixture/local"

test("a narrow masked dialog keeps both shortcuts readable and stores only on confirmation", async () => {
  await using app = await renderLocal()
  app.resize(38, 24)
  const values: string[] = []
  app.dialog.replace(() => (
    <DialogSecret title="Add secret" onCancel={app.dialog.clear} onConfirm={(value) => values.push(value)} />
  ))
  await app.renderOnce()
  const store = async () => {
    const lines = app.captureCharFrame().split("\n")
    const row = lines.findIndex((line) => line.includes("enter store"))
    expect(row).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(lines[row].indexOf("store"), row)
  }
  await store()
  expect(values).toEqual([])
  const sample = "demo-value-".repeat(5)
  await app.mockInput.typeText(sample)
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).not.toContain("demo")
  expect(frame).toContain("55 characters")
  expect(frame).toContain("esc cancel")
  await store()
  expect(values).toEqual([sample])
})

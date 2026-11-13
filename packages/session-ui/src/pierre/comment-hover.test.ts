import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHoverComment } from "./comment-hover"

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

test("tracks the last line and removes document listeners when disposed", () => {
  let reads = 0
  let hovered = { lineNumber: 5, side: "additions" as const } as
    | { lineNumber: number; side: "additions" | "deletions" }
    | undefined
  const selected: number[] = []
  const comment = createHoverComment({
    label: "Comment",
    getHoveredLine: () => {
      reads++
      return hovered
    },
    onSelect: (line) => selected.push(line.lineNumber),
  })!
  document.body.replaceChildren(comment.button)

  document.dispatchEvent(new Event("pointermove"))
  hovered = undefined
  comment.button.click()
  expect(selected).toEqual([5])

  const beforeDispose = reads
  comment.dispose()
  document.dispatchEvent(new Event("pointermove"))
  document.dispatchEvent(new Event("scroll"))
  expect(reads).toBe(beforeDispose)
  expect(comment.canReuse()).toBe(false)
})

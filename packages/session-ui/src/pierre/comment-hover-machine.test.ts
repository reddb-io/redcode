import { expect, test } from "bun:test"
import {
  DISPOSED_HOVER_COMMENT_STATE,
  INITIAL_HOVER_COMMENT_STATE,
  selectHoverActive,
  selectHoverLine,
  transitionHoverComment,
  type HoverCommentEvent,
  type HoverCommentSide,
} from "./comment-hover-machine"

const hover = (lineNumber?: number, side?: HoverCommentSide): HoverCommentEvent => ({
  type: "hover.synced",
  lineNumber,
  side,
})

test("keeps the last hovered line until the button is disposed", () => {
  const hovered = transitionHoverComment(INITIAL_HOVER_COMMENT_STATE, hover(12, "additions"))
  expect(transitionHoverComment(hovered, hover())).toBe(hovered)
  expect(selectHoverLine(hovered)).toEqual({ lineNumber: 12, side: "additions" })

  const disposed = transitionHoverComment(hovered, { type: "disposed" })
  expect(disposed).toBe(DISPOSED_HOVER_COMMENT_STATE)
  expect(selectHoverActive(disposed)).toBe(false)
  expect(selectHoverLine(disposed)).toBeUndefined()
  expect(transitionHoverComment(disposed, hover(3))).toBe(disposed)
})

test("does not allocate a new state when hover identity is unchanged", () => {
  const hovered = transitionHoverComment(INITIAL_HOVER_COMMENT_STATE, hover(7, "deletions"))
  expect(transitionHoverComment(hovered, hover(7, "deletions"))).toBe(hovered)
})

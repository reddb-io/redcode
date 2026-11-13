export type HoverCommentSide = "additions" | "deletions"

export type HoverCommentLine = {
  readonly lineNumber: number
  readonly side?: HoverCommentSide
}

export type HoverCommentState =
  | { readonly status: "tracking"; readonly line: HoverCommentLine | undefined }
  | { readonly status: "disposed" }

export type HoverCommentSync = {
  type: "hover.synced"
  lineNumber: number | undefined
  side: HoverCommentSide | undefined
}

export type HoverCommentEvent = Readonly<HoverCommentSync> | { readonly type: "disposed" }

export const INITIAL_HOVER_COMMENT_STATE: HoverCommentState = Object.freeze({ status: "tracking", line: undefined })
export const DISPOSED_HOVER_COMMENT_STATE: HoverCommentState = Object.freeze({ status: "disposed" })

export function transitionHoverComment(state: HoverCommentState, event: HoverCommentEvent): HoverCommentState {
  if (state.status === "disposed") return state
  if (event.type === "disposed") return DISPOSED_HOVER_COMMENT_STATE
  if (
    event.lineNumber === undefined ||
    (event.lineNumber === state.line?.lineNumber && event.side === state.line?.side)
  )
    return state
  return { status: "tracking", line: { lineNumber: event.lineNumber, side: event.side } }
}

export function selectHoverActive(state: HoverCommentState) {
  return state.status !== "disposed"
}

export function selectHoverLine(state: HoverCommentState) {
  return state.status === "disposed" ? undefined : state.line
}

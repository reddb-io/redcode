import {
  INITIAL_HOVER_COMMENT_STATE,
  selectHoverActive,
  selectHoverLine,
  transitionHoverComment,
  type HoverCommentEvent,
  type HoverCommentLine,
  type HoverCommentSync,
} from "./comment-hover-machine"

export type { HoverCommentLine }

export type HoverComment = {
  button: HTMLButtonElement
  dispose: () => void
  canReuse: () => boolean
}

export function createHoverComment(props: {
  label: string
  getHoveredLine: () => HoverCommentLine | undefined
  onSelect: (line: HoverCommentLine) => void
}): HoverComment | undefined {
  if (typeof document === "undefined") return

  const button = document.createElement("button")
  button.type = "button"
  button.ariaLabel = props.label
  button.textContent = "+"
  button.style.width = "20px"
  button.style.height = "20px"
  button.style.display = "flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.border = "none"
  button.style.borderRadius = "var(--radius-md)"
  button.style.background = "var(--icon-interactive-base)"
  button.style.color = "var(--white)"
  button.style.boxShadow = "var(--shadow-xs)"
  button.style.fontSize = "14px"
  button.style.lineHeight = "1"
  button.style.cursor = "pointer"
  button.style.position = "relative"
  button.style.left = "30px"
  button.style.top = "calc((var(--diffs-line-height, 24px) - 20px) / 2)"

  let state = INITIAL_HOVER_COMMENT_STATE
  const syncEvent: HoverCommentSync = { type: "hover.synced", lineNumber: undefined, side: undefined }

  const dispatch = (event: HoverCommentEvent) => {
    const next = transitionHoverComment(state, event)
    if (next === state) return
    const active = selectHoverActive(state)
    state = next

    if (active && !selectHoverActive(state)) {
      document.removeEventListener("pointermove", sync)
      document.removeEventListener("scroll", sync, true)
    }
  }

  const sync = () => {
    if (!button.isConnected) return
    const hovered = props.getHoveredLine()
    syncEvent.lineNumber = hovered?.lineNumber
    syncEvent.side = hovered?.side
    dispatch(syncEvent)
  }

  document.addEventListener("pointermove", sync, { passive: true })
  document.addEventListener("scroll", sync, { passive: true, capture: true })
  button.addEventListener("mouseenter", sync)
  button.addEventListener("mousemove", sync)
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  })
  button.addEventListener("mousedown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  })
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
    const line = selectHoverLine(state)
    if (line) props.onSelect(line)
  })

  return {
    button,
    dispose: () => dispatch({ type: "disposed" }),
    canReuse: () => selectHoverActive(state),
  }
}

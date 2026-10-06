import { createSignal } from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { Design } from "@opencode/schema/design"
import { useTheme } from "../context/theme"

/** Transcript card of a Design approval: what was approved, and the way back to the review. */
export function DesignApprovalNotice(props: {
  notice: Design.ApprovalNotice
  /** The approved revision's number (R7), when the transcript announced it. */
  ordinal?: number
  onOpen: () => void
}) {
  const theme = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  return (
    <box
      marginTop={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexShrink={0}
      backgroundColor={theme.background.raised.base}
    >
      <text fg={theme.text.feedback.success.base}>Design approved · {props.notice.name}</text>
      <text fg={theme.text.base}>
        {props.notice.variant?.name ?? "Entire revision"}
        <span style={{ fg: theme.text.muted }}>
          {" "}
          · {props.ordinal ? `R${props.ordinal} · ` : ""}
          {props.notice.revision}
        </span>
      </text>
      <text fg={theme.text.muted}>Decisions and acceptance criteria are saved. Continue in Plan.</text>
      <text
        fg={hover() ? theme.text.action.secondary.hovered : theme.text.action.secondary.base}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => {
          if (renderer.getSelection()?.getSelectedText()) return
          props.onOpen()
        }}
      >
        Open design and decisions · /review
      </text>
    </box>
  )
}

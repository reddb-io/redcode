import { TextAttributes } from "@opentui/core"
import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"

export function DialogMessage(props: { title: string; message: string; children: JSX.Element }) {
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={1} wrapMode="word">
          {props.title}
        </text>
        <text fg={theme.text.action.secondary.base} flexShrink={0} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text.muted} wrapMode="word">
        {props.message}
      </text>
      <box flexDirection="row" flexWrap="wrap" gap={1} justifyContent="flex-end" paddingBottom={1}>
        {props.children}
      </box>
    </box>
  )
}

export function DialogAction(props: { label: string; focused: boolean; onPress: () => void }) {
  const theme = useTheme().surface("dialog")
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={1}
      backgroundColor={props.focused ? theme.background.action.primary.focused : undefined}
      onMouseUp={props.onPress}
    >
      <text wrapMode="word" fg={props.focused ? theme.text.action.primary.focused : theme.text.action.secondary.base}>
        {props.label}
      </text>
    </box>
  )
}

import { TextAttributes } from "@opentui/core"
import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"

export function DialogMessage(props: {
  title: string
  message: string
  dismissLabel?: string
  onDismiss: () => void
  children: JSX.Element
}) {
  const theme = useTheme().surface("dialog")
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <DialogHeading title={props.title} dismissLabel={props.dismissLabel} onDismiss={props.onDismiss} />
      <text fg={theme.text.muted} wrapMode="word">
        {props.message}
      </text>
      <box flexDirection="row" flexWrap="wrap" gap={1} justifyContent="flex-end" paddingBottom={1}>
        {props.children}
      </box>
    </box>
  )
}

export function DialogHeading(props: {
  title: string
  titleView?: JSX.Element
  dismissLabel?: string
  disabled?: boolean
  onDismiss: () => void
}) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1}>
      {props.titleView ?? (
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={1} wrapMode="word">
          {props.title}
        </text>
      )}
      <text
        fg={props.disabled ? theme.text.action.secondary.disabled : theme.text.action.secondary.base}
        flexShrink={0}
        onMouseUp={() => {
          if (!props.disabled) props.onDismiss()
        }}
      >
        {props.dismissLabel ?? "esc"}
      </text>
    </box>
  )
}

export function DialogAction(props: { label: string; focused: boolean; primary?: boolean; onPress: () => void }) {
  const theme = useTheme().surface("dialog")
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={1}
      backgroundColor={
        props.focused
          ? theme.background.action.primary.focused
          : props.primary
            ? theme.background.action.primary.base
            : undefined
      }
      onMouseUp={props.onPress}
    >
      <text
        wrapMode="word"
        fg={
          props.focused
            ? theme.text.action.primary.focused
            : props.primary
              ? theme.text.action.primary.base
              : theme.text.action.secondary.base
        }
      >
        {props.label}
      </text>
    </box>
  )
}

import { useTheme } from "../context/theme"

export function ActionButton(props: {
  label: string
  focused?: boolean
  primary?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const emphasis = () => (props.focused || props.primary ? "primary" : "secondary")
  const state = () => (props.disabled ? "disabled" : props.focused ? "focused" : "base")
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={1}
      maxWidth="100%"
      backgroundColor={emphasis() === "primary" ? theme.background.action.primary[state()] : undefined}
      onMouseUp={() => {
        if (!props.disabled) props.onPress()
      }}
    >
      <text wrapMode="word" fg={theme.text.action[emphasis()][state()]}>
        {props.label}
      </text>
    </box>
  )
}

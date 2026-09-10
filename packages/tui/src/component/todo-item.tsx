import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
  reason?: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: ["in_progress", "blocked"].includes(props.status) ? theme.warning : theme.textMuted,
        }}
      >
        [
        {props.status === "completed"
          ? "✓"
          : props.status === "in_progress"
            ? "•"
            : props.status === "blocked"
              ? "!"
              : props.status === "cancelled"
                ? "−"
                : " "}
        ]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: ["in_progress", "blocked"].includes(props.status) ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
        {props.reason ? ` — ${props.reason}` : ""}
      </text>
    </box>
  )
}

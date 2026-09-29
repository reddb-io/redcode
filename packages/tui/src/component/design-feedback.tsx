import { For, Show } from "solid-js"
import type { Design } from "@opencode/schema/design"
import { useTheme } from "../context/theme"

/** Compact transcript view of admitted browser feedback; the model reads the rendered message instead. */
export function DesignFeedbackNotice(props: { notice: Design.FeedbackNotice }) {
  const theme = useTheme()
  const details = () =>
    [
      props.notice.id,
      props.notice.target,
      props.notice.revision,
      props.notice.variant ?? undefined,
      props.notice.ended ? "ended" : undefined,
    ]
      .filter(Boolean)
      .join(" · ")
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
      <text fg={theme.text.base}>
        <span style={{ bold: true }}>Design review</span>
        <span style={{ fg: theme.text.muted }}> · {details()}</span>
      </text>
      <Show when={props.notice.operation}>
        {(operation) => <text fg={theme.text.base}>Variant operation: {operation()}</text>}
      </Show>
      <Show when={props.notice.text}>
        <text fg={theme.text.base}>{props.notice.text}</text>
      </Show>
      <For each={props.notice.notes}>
        {(note, index) => (
          <text fg={theme.text.base}>
            <span style={{ fg: theme.text.muted }}>{index() + 1}. </span>
            <span style={{ bold: true }}>{note.label}</span>
            <span style={{ fg: theme.text.muted }}> — </span>
            {note.text}
          </text>
        )}
      </For>
      <Show when={props.notice.attachments.length}>
        <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
          <For each={props.notice.attachments}>
            {(name) => (
              <text fg={theme.text.muted}>
                <span style={{ bg: theme.decrease(theme.background.raised.base), fg: theme.text.muted }}>
                  {` image ${name} `}
                </span>
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={props.notice.snapshot}>
        <text fg={theme.text.muted}>Page text captured; available on demand.</text>
      </Show>
    </box>
  )
}

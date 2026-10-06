import { For, Show } from "solid-js"
import type { Design } from "@opencode/schema/design"
import { useTheme } from "../context/theme"

/** Compact transcript view of admitted browser feedback; the model reads the rendered message instead. */
export function DesignFeedbackNotice(props: {
  notice: Design.FeedbackNotice
  /** The number (R7) of the revision the notes were taken on, when the transcript announced it. */
  ordinal?: number
}) {
  const theme = useTheme()
  // The count the reviewer sent: a message cut by an older renderer lists fewer notes than it names.
  const sent = () => props.notice.sent ?? props.notice.notes.length
  const details = () =>
    [
      props.notice.round === undefined ? undefined : `round ${props.notice.round}`,
      sent() ? `${sent()} note${sent() === 1 ? "" : "s"}` : undefined,
      props.notice.id,
      props.notice.target,
      props.ordinal ? `on R${props.ordinal}` : props.notice.revision,
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
      <Show when={props.notice.notes.length < sent()}>
        <text fg={theme.text.feedback.warning.base}>
          {props.notice.notes.length} of {sent()} note{sent() === 1 ? "" : "s"} reached the agent
        </text>
      </Show>
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

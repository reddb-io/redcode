import { createMemo, For, Show } from "solid-js"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { useTheme } from "../context/theme"

/** Compact transcript view of admitted browser feedback; the model reads the rendered message instead. */
export function DesignFeedbackNotice(props: { value: unknown }) {
  const theme = useTheme()
  const notice = createMemo(() => (Schema.is(Design.FeedbackNotice)(props.value) ? props.value : undefined))
  return (
    <Show when={notice()}>
      {(record) => (
        <box
          marginTop={1}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.theme.backgroundPanel}
        >
          <text fg={theme.theme.accent}>
            Design review · {record().id} · {record().revision}
            {record().variant ? ` · ${record().variant}` : ""}
            {record().ended ? " · ended" : ""}
          </text>
          <Show when={record().text}>
            <text fg={theme.theme.text}>{record().text}</text>
          </Show>
          <For each={record().notes}>
            {(note, index) => (
              <text fg={theme.theme.text}>
                <span style={{ fg: theme.theme.textMuted }}>{index() + 1}. </span>
                <span style={{ bold: true }}>{note.label}</span>
                <span style={{ fg: theme.theme.textMuted }}> — </span>
                {note.text}
              </text>
            )}
          </For>
          <Show when={record().attachments.length}>
            <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
              <For each={record().attachments}>
                {(name) => (
                  <text fg={theme.theme.text}>
                    <span style={{ bg: theme.theme.secondary, fg: theme.theme.background }}> Image </span>
                    <span style={{ bg: theme.theme.backgroundElement, fg: theme.theme.textMuted }}> {name} </span>
                  </text>
                )}
              </For>
            </box>
          </Show>
          <Show when={record().snapshot}>
            <text fg={theme.theme.textMuted}>Page text captured; available on demand.</text>
          </Show>
        </box>
      )}
    </Show>
  )
}

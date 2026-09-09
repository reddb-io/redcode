import { createMemo, Show } from "solid-js"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { useTheme } from "../context/theme"
import { useOpencodeKeymap } from "../keymap"

export function DesignApprovalNotice(props: { value: unknown }) {
  const theme = useTheme()
  const keymap = useOpencodeKeymap()
  const notice = createMemo(() => (Schema.is(Design.ApprovalNotice)(props.value) ? props.value : undefined))
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
          <text fg={theme.theme.success}>Design approved · {record().name}</text>
          <text fg={theme.theme.text}>
            {record().variant?.name ?? "Entire revision"} · {record().revision}
          </text>
          <text fg={theme.theme.textMuted}>Decisions and acceptance criteria are saved. Continue in Plan.</text>
          <text fg={theme.theme.accent} onMouseUp={() => keymap.dispatchCommand("session.design.review")}>
            Open design and decisions · /design-review
          </text>
        </box>
      )}
    </Show>
  )
}

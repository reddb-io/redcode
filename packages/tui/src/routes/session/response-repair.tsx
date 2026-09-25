import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { responseQuestionReason } from "@reddb-io/redcode-core/session/response-revision"
import { useTheme } from "../../context/theme"

// The web app folds revisions the same way.
export {
  responseRepairIssues,
  responseRevisions,
  responseQuestionReason,
} from "@reddb-io/redcode-core/session/response-revision"

/**
 * The muted footnote under a revised answer. The superseded answer (`children`) renders only once
 * the user opens it, so the reply reads as the final answer alone. Expanding it also shows S1's
 * confidence for each named issue, when the repair carried one.
 */
export function ResponseRevisionNote(props: {
  issues: ReadonlyArray<string>
  confidence?: Readonly<Record<string, number>>
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(false)
  const reason = createMemo(() => props.issues.map((issue) => responseQuestionReason(issue)).join(", "))
  return (
    <>
      <box paddingLeft={3} marginTop={1} flexShrink={0}>
        <text fg={theme.textMuted} onMouseUp={() => setOpen((value) => !value)}>
          ↻ revised by S1{reason() ? ` — ${reason()}` : ""} · {open() ? "hide original" : "show original"}
        </text>
      </box>
      <Show when={open()}>
        <For each={props.issues.filter((issue) => props.confidence?.[issue] !== undefined)}>
          {(issue) => (
            <box paddingLeft={3} flexShrink={0}>
              <text fg={theme.textMuted}>
                S1: {Math.round(props.confidence![issue]! * 100)}% sure the answer {responseQuestionReason(issue)}
              </text>
            </box>
          )}
        </For>
        {props.children}
      </Show>
    </>
  )
}

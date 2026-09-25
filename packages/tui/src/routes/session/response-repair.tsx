import { createSignal, Show, type JSX } from "solid-js"
import { useTheme } from "../../context/theme"

// The web app folds revisions the same way.
export { responseRepairIssues, responseRevisions } from "@reddb-io/redcode-core/session/response-revision"

/**
 * The muted footnote under a revised answer. The superseded answer (`children`) renders only once
 * the user opens it, so the reply reads as the final answer alone.
 */
export function ResponseRevisionNote(props: { issues: ReadonlyArray<string>; children: JSX.Element }) {
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <box paddingLeft={3} marginTop={1} flexShrink={0}>
        <text fg={theme.textMuted} onMouseUp={() => setOpen((value) => !value)}>
          ↻ revised after S1 review{props.issues.length ? ` (${props.issues.join(", ")})` : ""} ·{" "}
          {open() ? "hide original" : "show original"}
        </text>
      </box>
      <Show when={open()}>{props.children}</Show>
    </>
  )
}

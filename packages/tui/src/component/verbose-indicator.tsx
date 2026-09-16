import { Show } from "solid-js"
import { BootTrace } from "@reddb-io/redcode-core/observability/boot-trace"
import { useTheme } from "../context/theme"

/**
 * Where the `--verbose` trace went. The screen took the terminal over before boot finished, so
 * the person who asked for the trace has to be told where the rest of it is being written.
 */
export function verboseIndicatorText() {
  if (!BootTrace.enabled()) return
  return `verbose · log: ${BootTrace.filePath()}`
}

export function VerboseIndicator() {
  const { theme } = useTheme()
  const text = verboseIndicatorText()
  return (
    <Show when={text}>
      <text fg={theme.textMuted} flexShrink={0}>
        {text}
      </text>
    </Show>
  )
}

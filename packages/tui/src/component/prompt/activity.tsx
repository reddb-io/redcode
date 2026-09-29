import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useData } from "../../context/data"
import { useEvent } from "../../context/event"
import { useTheme } from "../../context/theme"
import { SessionActivity } from "../../util/session-activity"

/**
 * The running footer's account of what the assistant is doing: the busy phase and step, a plain
 * "nothing arrived" once the stream has been silent past the notice threshold, and the latest
 * guard intervention (stall warning, loop correction) of this run. Read-only.
 */
export function PromptActivity(props: { sessionID: string }) {
  const data = useData()
  const event = useEvent()
  const theme = useTheme()
  const messages = createMemo(() => data.session.message.list(props.sessionID))
  const activity = createMemo(() => SessionActivity.activity(messages()))
  const [now, setNow] = createSignal(Date.now())
  const [moved, setMoved] = createSignal(Date.now())
  createEffect(
    on(
      () => SessionActivity.progress(messages()),
      () => setMoved(Date.now()),
    ),
  )
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))
  // Mounted only while the Session runs, so a trip from an earlier run never shows.
  const [trip, setTrip] = createSignal<string>()
  onCleanup(
    event.on("session.guard.tripped", (evt) => {
      if (evt.data.sessionID === props.sessionID) setTrip(SessionActivity.guardHint(evt.data))
    }),
  )
  const quiet = createMemo(() => SessionActivity.quiet(activity(), now() - moved()))

  return (
    <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1}>
      {SessionActivity.describe(activity())}
      <Show when={quiet()}>{(line) => <span style={{ fg: theme.text.feedback.warning.base }}> · {line()}</span>}</Show>
      <Show when={trip()}>{(line) => <span style={{ fg: theme.text.feedback.warning.base }}> · {line()}</span>}</Show>
    </text>
  )
}

import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useRoute } from "../../context/route"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"
import { sessionFamily } from "../../util/session"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"

type Theme = ReturnType<typeof useTheme>

const CHECKPOINT_ACTION: Record<SubagentReview.CheckpointAction, string> = {
  steer: "hint sent",
  ask_user: "asked",
  stop: "stopped",
}

function decisionColor(theme: Theme, decision: SubagentReview.Decision) {
  if (decision === "verified") return theme.text.feedback.success.base
  if (decision === "inconclusive") return theme.text.feedback.warning.base
  if (decision === "needs_revision") return theme.text.feedback.error.base
  return theme.text.muted
}

export function checkpointLabel(state: SubagentReview.CheckpointState) {
  if (state.type === "corrected") return "corrected (hint sent)"
  if (state.type === "stopped") return `stopped · ${state.line}`
  return "in scope"
}

/**
 * The verdict badge and stop-loss state of one subagent, for its task row:
 * `✓ verified · corrected (hint sent)`. Nothing while there is neither.
 */
export function SubagentVerdict(props: {
  decision?: SubagentReview.Decision
  checkpoint: SubagentReview.CheckpointState
}) {
  const theme = useTheme()
  return (
    <Show when={props.decision || props.checkpoint.type !== "in_scope"}>
      <text flexShrink={0} wrapMode="none">
        <Show when={props.decision}>
          {(decision) => (
            <span style={{ fg: decisionColor(theme, decision()) }}>
              {SubagentReview.SYMBOL[decision()]} {SubagentReview.LABEL[decision()]}
            </span>
          )}
        </Show>
        <Show when={props.decision && props.checkpoint.type !== "in_scope"}>
          <span style={{ fg: theme.text.muted }}> · </span>
        </Show>
        <Show when={props.checkpoint.type !== "in_scope"}>
          <span
            style={{
              fg:
                props.checkpoint.type === "stopped"
                  ? theme.text.feedback.error.base
                  : theme.text.feedback.warning.base,
            }}
          >
            {checkpointLabel(props.checkpoint)}
          </span>
        </Show>
      </text>
    </Show>
  )
}

/**
 * Inside a subagent: the brief it was launched under, collapsed to its goal until clicked, and the
 * stop-loss checkpoints that acted on it. Checkpoints come from the brief and, while the subagent
 * runs, from the notices in its transcript that the brief does not hold yet.
 */
export function SubagentBrief(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme()
  const [open, setOpen] = createSignal(false)
  const brief = createMemo(() => SubagentReview.read(data.session.get(props.sessionID)?.metadata))
  const checkpoints = createMemo(() => {
    const stored = brief()?.checkpoints ?? []
    const since = stored.at(-1)?.at ?? 0
    const live = data.session.message
      .list(props.sessionID)
      .flatMap((message) => {
        if (message.type !== "synthetic") return []
        const checkpoint = SubagentReview.checkpoint(message, message.time.created)
        return checkpoint && checkpoint.at > since ? [checkpoint] : []
      })
    return [...stored, ...live].slice(-SubagentReview.CHECKPOINT_LIMIT)
  })
  return (
    <Show when={brief() || checkpoints().length > 0}>
      <box flexShrink={0} paddingLeft={2} paddingRight={1} paddingBottom={1}>
        <Show when={brief()}>
          {(value) => (
            <box flexShrink={0}>
              <text
                id="subagent-brief-toggle"
                fg={theme.text.muted}
                wrapMode="none"
                onMouseUp={() => setOpen((next) => !next)}
              >
                <span style={{ fg: theme.text.action.secondary.base }}>{open() ? "▾" : "▸"} Brief</span>
                <Show when={!open()}> — {Locale.truncate(value().prompt.replace(/\s+/g, " "), 80)}</Show>
                <Show when={value().result}>
                  {(result) => (
                    <span style={{ fg: decisionColor(theme, result().decision) }}>
                      {"  "}
                      {SubagentReview.SYMBOL[result().decision]} {SubagentReview.LABEL[result().decision]}
                    </span>
                  )}
                </Show>
              </text>
              <Show when={open()}>
                <box paddingLeft={2} flexShrink={0}>
                  <text fg={theme.text.base} wrapMode="word">
                    <span style={{ fg: theme.text.muted }}>Goal </span>
                    {value().prompt}
                  </text>
                  <BriefList title="Scope" items={value().scope} />
                  <BriefList title="Done criteria" items={value().criteria} />
                  <Show when={value().returnFormat}>
                    {(format) => (
                      <text fg={theme.text.base} wrapMode="word">
                        <span style={{ fg: theme.text.muted }}>Return format </span>
                        {format()}
                      </text>
                    )}
                  </Show>
                </box>
              </Show>
            </box>
          )}
        </Show>
        <Show when={checkpoints().length > 0}>
          <box flexShrink={0}>
            <text fg={theme.text.base}>Checkpoints</text>
            <For each={checkpoints()}>
              {(checkpoint) => (
                <text
                  paddingLeft={2}
                  fg={checkpoint.action === "steer" ? theme.text.feedback.warning.base : theme.text.feedback.error.base}
                  wrapMode="word"
                >
                  {checkpoint.line} · {CHECKPOINT_ACTION[checkpoint.action]}
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </Show>
  )
}

function BriefList(props: { title: string; items: ReadonlyArray<string> }) {
  const theme = useTheme()
  return (
    <Show when={props.items.length > 0}>
      <text fg={theme.text.muted}>{props.title}</text>
      <For each={props.items}>{(item) => <text fg={theme.text.base}> • {item}</text>}</For>
    </Show>
  )
}

export function SidebarSubagents(props: { sessionID: string }) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const children = createMemo(() => sessionFamily(data.session.list(), props.sessionID))

  const steer = (sessionID: string) => {
    dialog.replace(() => (
      <DialogPrompt
        title="Steer subagent"
        placeholder="What should it do differently?"
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const text = value.trim()
          if (!text) return
          dialog.clear()
          // Admission preserves the child's selected agent/model and delivers at its next safe boundary.
          void client.api.session
            .prompt({ sessionID, text, delivery: "steer" })
            .then(() => toast.show({ variant: "success", message: "Hint sent to the subagent" }))
            .catch(toast.error)
        }}
      />
    ))
  }
  const kill = (sessionID: string, title: string) => {
    dialog.replace(() => (
      <DialogConfirm
        title="Kill subagent"
        message={`Abort ${title}?`}
        onConfirm={() => {
          void client.api.session.interrupt({ sessionID }).catch(toast.error)
        }}
      />
    ))
  }

  return (
    <box flexShrink={0} gap={1}>
      <Show when={children().length === 0}>
        <text fg={theme.text.muted}>No subagents in this session.</text>
      </Show>
      <For each={children()}>
        {(entry) => {
          const running = () => data.session.status(entry.session.id) === "running"
          return (
            <box flexShrink={0}>
              <text fg={theme.text.base} wrapMode="none">
                {entry.prefix}
                <span style={{ fg: running() ? theme.text.feedback.info.base : theme.text.muted }}>
                  {running() ? "●" : "·"}
                </span>{" "}
                {withTimestampedFallback(entry.session).replace(/ \(@\w+ subagent\)$/, "")}
              </text>
              <text fg={theme.text.muted} paddingLeft={2} wrapMode="word">
                {data.session.status(entry.session.id)}
                <Show when={entry.session.model}>
                  {(model) => (
                    <>
                      {" · "}
                      {model().id}
                      {model().variant ? ` (${model().variant})` : ""}
                    </>
                  )}
                </Show>
              </text>
              <box flexDirection="row" gap={2} paddingLeft={2}>
                <text
                  id={`subagent-open-${entry.session.id}`}
                  fg={theme.text.action.primary.selected}
                  attributes={TextAttributes.UNDERLINE}
                  onMouseUp={() => route.navigate({ type: "session", sessionID: entry.session.id })}
                >
                  open
                </text>
                <Show when={running()}>
                  <text
                    id={`subagent-steer-${entry.session.id}`}
                    fg={theme.text.action.primary.base}
                    attributes={TextAttributes.UNDERLINE}
                    onMouseUp={() => steer(entry.session.id)}
                  >
                    steer
                  </text>
                  <text
                    id={`subagent-kill-${entry.session.id}`}
                    fg={theme.text.action.destructive.base}
                    bg={theme.background.action.destructive.base}
                    attributes={TextAttributes.UNDERLINE}
                    onMouseUp={() => kill(entry.session.id, withTimestampedFallback(entry.session))}
                  >
                    kill
                  </text>
                </Show>
              </box>
            </box>
          )
        }}
      </For>
    </box>
  )
}

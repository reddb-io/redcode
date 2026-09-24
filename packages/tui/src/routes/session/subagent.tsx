import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { ToolPart } from "@reddb-io/redcode-sdk/v2"
import { SubagentView } from "@reddb-io/redcode-core/session/subagent-view"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useSync, type GuardTrip } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"

type Theme = ReturnType<typeof useTheme>["theme"]

export const DECISION_LABEL: Record<SubagentView.Decision, string> = {
  verified: "verified",
  inconclusive: "inconclusive",
  needs_revision: "needs revision",
  unverified: "unverified",
}

export function checkpointLabel(state: SubagentView.CheckpointState) {
  if (state.type === "corrected") return "corrected (hint sent)"
  if (state.type === "stopped") return `stopped · ${state.reason}`
  return "in scope"
}

function decisionColor(theme: Theme, decision: SubagentView.Decision) {
  if (decision === "verified") return theme.success
  if (decision === "inconclusive") return theme.warning
  if (decision === "needs_revision") return theme.error
  return theme.textMuted
}

function checkpointColor(theme: Theme, state: SubagentView.CheckpointState) {
  if (state.type === "corrected") return theme.warning
  if (state.type === "stopped") return theme.error
  return theme.textMuted
}

/**
 * The model, verdict badge and checkpoint state of one subagent, as spans for a task row's text:
 * `claude-opus-5 (high) · ✓ verified · in scope`.
 */
export function SubagentSummary(props: {
  model?: SubagentView.Model
  decision?: SubagentView.Decision
  checkpoint: SubagentView.CheckpointState
}) {
  const { theme } = useTheme()
  const segments = createMemo(() => [
    ...(props.model ? [{ text: SubagentView.modelLabel(props.model), fg: theme.textMuted }] : []),
    ...(props.decision
      ? [
          {
            text: `${SubagentView.SYMBOL[props.decision]} ${DECISION_LABEL[props.decision]}`,
            fg: decisionColor(theme, props.decision),
          },
        ]
      : []),
    { text: checkpointLabel(props.checkpoint), fg: checkpointColor(theme, props.checkpoint) },
  ])
  return (
    <For each={segments()}>
      {(segment, index) => (
        <>
          <Show when={index() > 0}>
            <span style={{ fg: theme.textMuted }}> · </span>
          </Show>
          <span style={{ fg: segment.fg }}>{segment.text}</span>
        </>
      )}
    </For>
  )
}

/** The brief a subagent runs under, collapsed to its goal, and the checkpoints that acted on it. */
export function SubagentBrief(props: {
  brief?: SubagentView.Brief
  checkpoints: ReadonlyArray<SubagentView.Checkpoint>
}) {
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(false)
  return (
    <box flexShrink={0}>
      <Show when={props.brief}>
        {(brief) => (
          <box flexShrink={0}>
            <text fg={theme.textMuted} wrapMode="none" onMouseUp={() => setOpen((value) => !value)}>
              <span style={{ fg: theme.text }}>{open() ? "▾" : "▸"} Brief</span>
              <Show when={!open()}> — {Locale.truncate(brief().goal.replace(/\s+/g, " "), 80)}</Show>
            </text>
            <Show when={open()}>
              <box paddingLeft={2} flexShrink={0}>
                <text fg={theme.text}>
                  <span style={{ fg: theme.textMuted }}>Goal </span>
                  {brief().goal}
                </text>
                <BriefList title="Scope" items={brief().scope} />
                <BriefList title="Done criteria" items={brief().criteria} />
                <Show when={brief().returnFormat}>
                  {(format) => (
                    <text fg={theme.text}>
                      <span style={{ fg: theme.textMuted }}>Return format </span>
                      {format()}
                    </text>
                  )}
                </Show>
              </box>
            </Show>
          </box>
        )}
      </Show>
      <Show when={props.checkpoints.length > 0}>
        <box flexShrink={0}>
          <text fg={theme.text}>Checkpoints</text>
          <For each={props.checkpoints}>
            {(checkpoint) => (
              <text paddingLeft={2} fg={checkpoint.action === "steer" ? theme.warning : theme.error} wrapMode="word">
                {checkpoint.line} · {checkpointAction(checkpoint)}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function checkpointAction(checkpoint: SubagentView.Checkpoint) {
  if (checkpoint.action === "steer") return "hint sent"
  const verb = checkpoint.action === "ask_user" ? "asked" : "stopped"
  return checkpoint.reason ? `${verb}: ${checkpoint.reason}` : verb
}

function BriefList(props: { title: string; items: ReadonlyArray<string> }) {
  const { theme } = useTheme()
  return (
    <Show when={props.items.length > 0}>
      <text fg={theme.textMuted}>{props.title}</text>
      <For each={props.items}>{(item) => <text fg={theme.text}> • {item}</text>}</For>
    </Show>
  )
}

export type SubagentItem = {
  id: string
  title: string
  status: SubagentView.Status
  model?: SubagentView.Model
  decision?: SubagentView.Decision
}

const STATUS_SYMBOL: Record<SubagentView.Status, string> = { running: "●", done: "✓", stopped: "■" }

/** The children of a session, with what can be done to each: open it, steer it, or kill it while it runs. */
export function SubagentList(props: {
  items: ReadonlyArray<SubagentItem>
  onOpen: (id: string) => void
  onSteer: (id: string) => void
  onKill: (id: string) => void
}) {
  const { theme } = useTheme()
  const statusColor = (status: SubagentView.Status) =>
    status === "running" ? theme.primary : status === "stopped" ? theme.error : theme.success
  return (
    <box flexShrink={0} gap={1}>
      <Show when={props.items.length === 0}>
        <text fg={theme.textMuted}>No subagents in this session</text>
      </Show>
      <For each={props.items}>
        {(item) => (
          <box flexShrink={0}>
            <text fg={theme.text} wrapMode="none">
              <span style={{ fg: statusColor(item.status) }}>{STATUS_SYMBOL[item.status]}</span> {item.title}
            </text>
            <text fg={theme.textMuted} paddingLeft={2} wrapMode="word">
              <span style={{ fg: statusColor(item.status) }}>{item.status}</span>
              <Show when={item.model}>{(model) => <> · {SubagentView.modelLabel(model())}</>}</Show>
              <Show when={item.decision}>
                {(decision) => (
                  <>
                    {" · "}
                    <span style={{ fg: decisionColor(theme, decision()) }}>
                      {SubagentView.SYMBOL[decision()]} {DECISION_LABEL[decision()]}
                    </span>
                  </>
                )}
              </Show>
            </text>
            <box flexDirection="row" gap={2} paddingLeft={2}>
              <text fg={theme.primary} attributes={TextAttributes.UNDERLINE} onMouseUp={() => props.onOpen(item.id)}>
                open
              </text>
              <Show when={item.status === "running"}>
                <text fg={theme.warning} attributes={TextAttributes.UNDERLINE} onMouseUp={() => props.onSteer(item.id)}>
                  steer
                </text>
                <text fg={theme.error} attributes={TextAttributes.UNDERLINE} onMouseUp={() => props.onKill(item.id)}>
                  kill
                </text>
              </Show>
            </box>
          </box>
        )}
      </For>
    </box>
  )
}

/** The sidebar's Subagents tab: the children of this session, read from the session list. */
export function SidebarSubagents(props: { sessionID: string }) {
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()

  // The task call that launched each child carries the model and verdict it ran with.
  const tasks = createMemo(
    () =>
      new Map(
        (sync.data.message[props.sessionID] ?? []).flatMap((message) =>
          (sync.data.part[message.id] ?? []).flatMap((part) => {
            if (part.type !== "tool" || part.tool !== "task") return []
            const metadata = taskMetadata(part)
            const id = metadata?.sessionId
            return typeof id === "string" ? [[id, metadata] as const] : []
          }),
        ),
      ),
  )

  const items = createMemo(() =>
    sync.data.session
      .filter((session) => session.parentID === props.sessionID)
      .toSorted((a, b) => a.time.created - b.time.created)
      .map((session): SubagentItem => {
        const task = tasks().get(session.id)
        const status = sync.data.session_status[session.id]
        const model = SubagentView.model(task, session)
        const decision = SubagentView.decision(task, session.metadata)
        return {
          id: session.id,
          title: session.title.replace(/ \(@\w+ subagent\)$/, ""),
          status: SubagentView.status({
            busy: status !== undefined && status.type !== "idle",
            checkpoints: SubagentView.checkpoints(session.metadata),
          }),
          ...(model ? { model } : {}),
          ...(decision ? { decision } : {}),
        }
      }),
  )

  const steer = async (id: string) => {
    const text = await DialogPrompt.show(dialog, "Steer subagent", {
      placeholder: "What should it do differently?",
    })
    dialog.clear()
    if (!text?.trim()) return
    const child = sync.session.get(id)
    // Delivered at the child's next step boundary, like a steer typed into its own prompt.
    await sdk.client.session
      .prompt(
        {
          sessionID: id,
          ...(child?.agent ? { agent: child.agent } : {}),
          ...(child?.model ? { model: { providerID: child.model.providerID, modelID: child.model.id } } : {}),
          ...(child?.model?.variant ? { variant: child.model.variant } : {}),
          delivery: "steer",
          parts: [{ type: "text", text }],
        },
        { throwOnError: true },
      )
      .then(() => toast.show({ variant: "success", message: "Hint sent to the subagent" }))
      .catch((error) => toast.show({ variant: "error", message: errorMessage(error) }))
  }

  const kill = async (id: string) => {
    const title = sync.session.get(id)?.title ?? id
    if (!(await DialogConfirm.show(dialog, "Kill subagent", `Abort ${title}?`))) return
    await sdk.client.session
      .abort({ sessionID: id }, { throwOnError: true })
      .catch((error) => toast.show({ variant: "error", message: errorMessage(error) }))
  }

  return (
    <SubagentList
      items={items()}
      onOpen={(id) => route.navigate({ type: "session", sessionID: id })}
      onSteer={(id) => void steer(id)}
      onKill={(id) => void kill(id)}
    />
  )
}

function taskMetadata(part: ToolPart) {
  if (part.state.status === "pending") return undefined
  return part.state.metadata
}

const GUARD_LABEL: Record<string, string> = {
  stall: "stall watchdog",
  tool_timeout: "tool deadline",
  loop: "loop guard",
  steps: "step limit",
  aux: "call bound",
  orphan: "orphaned call",
  goal: "goal guard",
  compaction: "compaction guard",
  budget: "budget",
  intelligence: "S1",
  stop_loss: "stop-loss",
}

const ACTION_LABEL: Record<string, string> = { warn: "warned", correct: "corrected", stop: "stopped" }

/** `loop guard stopped · todowrite`: what intervened, what it did, and on what. */
export function guardTripTitle(trip: Pick<GuardTrip, "guard" | "action" | "subject">) {
  return [
    `${GUARD_LABEL[trip.guard] ?? trip.guard} ${ACTION_LABEL[trip.action] ?? trip.action}`,
    ...(trip.subject ? [trip.subject] : []),
  ].join(" · ")
}

/** One guard intervention: a single line until clicked, then its whole detail. */
export function GuardTripLine(props: { trip: GuardTrip }) {
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(false)
  const color = () => (props.trip.action === "stop" ? theme.error : theme.warning)
  const summary = () => Locale.truncate(props.trip.detail.replace(/\s+/g, " "), 72)
  return (
    <box marginTop={1} paddingLeft={3} flexShrink={0} onMouseUp={() => setOpen((value) => !value)}>
      <text fg={theme.textMuted} wrapMode="none">
        <span style={{ fg: color() }}>{open() ? "▾" : "▸"} Guard · </span>
        <span style={{ fg: color() }}>{guardTripTitle(props.trip)}</span>
        <Show when={!open() && summary()}> — {summary()}</Show>
      </text>
      <Show when={open()}>
        <text paddingLeft={2} fg={theme.textMuted}>
          {props.trip.detail}
        </text>
      </Show>
    </box>
  )
}

/**
 * The trips that happened while `messages[index]` was the latest message: at or after it started
 * and before the next one did. Trips before the first message sit with the first.
 */
export function guardTripsAt(
  messages: ReadonlyArray<{ time: { created: number } }>,
  trips: ReadonlyArray<GuardTrip>,
  index: number,
) {
  const start = index === 0 ? -Infinity : messages[index]!.time.created
  const end = messages[index + 1]?.time.created ?? Infinity
  return trips.filter((trip) => trip.time >= start && trip.time < end)
}

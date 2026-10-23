import { Plugin } from "@opencode/plugin/tui"
import type { SessionMessageAssistant } from "@opencode/client"
import { GenerationTiming } from "@opencode/util/generation-timing"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show } from "solid-js"
import { contextUsage } from "../../util/session"
import { Budget } from "../../util/budget"
import { formatCost } from "../../util/cost"

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const spend = createMemo(() => props.context.data.session.spend.get(props.sessionID))
  const cost = createMemo(() => formatCost(spend()?.spent.cost, spend()?.costAssessment))
  createEffect(() => {
    void props.context.data.session.spend.sync(props.sessionID).catch(() => undefined)
  })
  const usage = createMemo(() => `${cost()}:${JSON.stringify(session()?.tokens)}`)
  const [budget, { refetch }] = createResource(
    () => props.sessionID,
    (sessionID) => props.context.client.session.goal.get({ sessionID }).catch(() => undefined),
  )
  createEffect(on(usage, () => void refetch(), { defer: true }))
  const timer = setInterval(() => {
    if (!budget.loading) void refetch()
  }, 5_000)
  onCleanup(() => clearInterval(timer))
  const sessionBudget = createMemo(() => {
    const current = spend()
    return current && Budget.hasLimits(current.limits) ? Budget.lines(current.limits, current.spent) : []
  })
  const goalBudget = createMemo(() => {
    const goal = budget.latest
    const current = spend()
    if (!current || !goal?.budget || !["active", "waiting", "paused"].includes(goal.status)) return []
    return Budget.lines(goal.budget, Budget.since(current.spent, goal.spendStart))
  })

  // The latest step that streamed anything: bright while it streams, muted once it is over.
  const timing = createMemo(() => {
    const message = msg().findLast(
      (item): item is SessionMessageAssistant => item.type === "assistant" && item.time.first !== undefined,
    )
    return message ? GenerationTiming.step(message) : undefined
  })

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )

  return (
    <box>
      <text fg={theme.text.base}>
        <b>Context</b>
      </text>
      <text fg={theme.text.muted}>
        {(state()?.tokens ?? 0).toLocaleString()}
        <Show when={state()?.limit}>{(limit) => <> / {limit().toLocaleString()}</>}</Show> tokens
      </text>
      <text fg={theme.text.muted}>{state()?.percent ?? 0}% used</text>
      <text fg={theme.text.muted}>
        {cost()}
        {spend() && spend()?.costAssessment?.status !== "unknown" ? " spent" : ""}
      </text>
      <Show when={spend()?.costAssessment?.status === "unknown" && spend()!.spent.cost > 0}>
        <text fg={theme.text.muted}>+ known subtotal; some costs unknown</text>
      </Show>
      <Show when={spend() && (!spend()?.costAssessment || spend()?.costAssessment?.status === "legacy")}>
        <text fg={theme.text.muted}>* cost provenance unavailable</text>
      </Show>
      <Show when={spend()?.costAssessment?.status === "estimated"}>
        <text fg={theme.text.muted}>~ estimated cost</text>
      </Show>
      <For each={sessionBudget()}>{(line) => <text fg={theme.text.muted}>budget (with subagents) {line}</text>}</For>
      <For each={goalBudget()}>{(line) => <text fg={theme.text.muted}>goal budget (with subagents) {line}</text>}</For>
      <Show when={timing()}>
        {(step) => (
          <>
            <text fg={step().done ? theme.text.muted : theme.text.base}>
              {GenerationTiming.formatLatency(step().latency)} latency
            </text>
            {/* Only a real rate is shown: too few tokens or too short a window shows nothing. */}
            <Show when={step().speed}>
              {(speed) => (
                <text fg={step().done ? theme.text.muted : theme.text.base}>
                  {GenerationTiming.formatRate(speed())}
                </text>
              )}
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})

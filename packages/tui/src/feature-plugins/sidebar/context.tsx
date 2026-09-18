import type { AssistantMessage } from "@reddb-io/redcode-sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { GenerationTiming } from "@reddb-io/redcode-core/session/generation-timing"
import { Budget } from "../../util/budget"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)
  // Shown only for budgets the person set; a session without one looks exactly as before.
  const budget = createMemo(() =>
    Budget.sidebar({
      metadata: session()?.metadata,
      configured: props.api.state.config?.session?.budget,
      child: Boolean(session()?.parentID),
    }),
  )
  // The same selection and guards as the app: the latest measured step, compaction summaries and
  // replays skipped, no rate for a burst or a window too small to mean anything.
  const meter = createMemo(() => GenerationTiming.meter(msg()))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      {/* Budget spend counts subagents, compaction and judging too, so it can exceed "$ spent". */}
      <For each={budget().session}>{(line) => <text fg={theme().textMuted}>budget (with subagents) {line}</text>}</For>
      <For each={budget().goal}>{(line) => <text fg={theme().textMuted}>goal budget (with subagents) {line}</text>}</For>
      <Show when={meter()}>
        {(current) => (
          // Values of the step streaming now are bright; a finished, failed or aborted step's are muted.
          <box>
            <Show when={latencyLine(current().step)}>
              {(line) => <text fg={current().step.stale ? theme().textMuted : theme().text}>{line()}</text>}
            </Show>
            <Show when={speedLine(current().step)}>
              {(line) => <text fg={current().step.stale ? theme().textMuted : theme().text}>{line()}</text>}
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}

function latencyLine(step: GenerationTiming.Step) {
  if (step.latency === undefined) return undefined
  return `${GenerationTiming.formatLatency(step.latency)} latency`
}

// Only a real rate is shown: a burst, a window too short to mean anything and a step still waiting
// on its usage show nothing at all.
function speedLine(step: GenerationTiming.Step) {
  if (step.speed?.type !== "rate") return undefined
  return GenerationTiming.formatRate(step.speed.value)
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

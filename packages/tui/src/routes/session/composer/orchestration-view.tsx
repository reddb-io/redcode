import type { IntelligenceEvaluation, IntelligenceStatus, SessionInfo } from "@opencode/client"
import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { For, Show } from "solid-js"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { useTheme } from "../../../context/theme"
import { Locale } from "../../../util/locale"

export type OrchestrationNode = { session: SessionInfo; status: string; requests?: number }

export function orchestrationState(node: OrchestrationNode) {
  if (node.requests) return "Needs input"
  if (node.status === "running") return "Running"
  if (node.session.outcome === "failed") return "Failed"
  if (node.session.outcome === "interrupted") return "Interrupted"
  if (node.session.outcome === "succeeded") return "Completed"
  return "Idle"
}

// Keep keyboard order identical to the visible parent/child hierarchy.
export function orchestrationTree(nodes: readonly OrchestrationNode[], rootID: string) {
  const root = nodes.find((node) => node.session.id === rootID)
  if (!root) return []
  const walk = (id: string, prefix: string): Array<{ node: OrchestrationNode; prefix: string }> => {
    const children = nodes.filter((node) => node.session.parentID === id)
    return children.flatMap((node, index) => {
      const last = index === children.length - 1
      return [
        { node, prefix: prefix + (last ? "└─ " : "├─ ") },
        ...walk(node.session.id, prefix + (last ? "   " : "│  ")),
      ]
    })
  }
  return [{ node: root, prefix: "" }, ...walk(rootID, "")]
}

export function OrchestrationView(props: {
  rows: ReturnType<typeof orchestrationTree>
  selected: string
  select: (id: string) => void
  register: (id: string, element: BoxRenderable) => void
}) {
  const theme = useTheme()
  const tone = (state: string) => {
    if (state === "Failed") return theme.text.feedback.error.base
    if (state === "Needs input" || state === "Interrupted") return theme.text.feedback.warning.base
    if (state === "Completed") return theme.text.feedback.success.base
    if (state === "Running") return theme.text.feedback.info.base
    return theme.text.muted
  }
  return (
    <Show when={props.rows.length} fallback={<text fg={theme.text.muted}>No sessions available.</text>}>
      <For each={props.rows}>
        {(row) => (
          <box
            ref={(element) => props.register(row.node.session.id, element)}
            id={`orchestration-node-${row.node.session.id}`}
            flexDirection="row"
            minWidth={0}
            flexShrink={0}
            backgroundColor={row.node.session.id === props.selected ? theme.background.formfield.selected : undefined}
            onMouseUp={() => props.select(row.node.session.id)}
          >
            <text width={2} flexShrink={0} fg={theme.text.formfield.selected}>
              {row.node.session.id === props.selected ? "›" : ""}
            </text>
            <text
              flexGrow={1}
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={row.node.session.id === props.selected ? theme.text.formfield.selected : theme.text.base}
              attributes={!row.prefix ? TextAttributes.BOLD : undefined}
            >
              {row.prefix}
              {row.node.session.title || row.node.session.agent || "Untitled session"}
            </text>
            <text width={13} flexShrink={0} textAlign="right" fg={tone(orchestrationState(row.node))}>
              {orchestrationState(row.node)}
            </text>
          </box>
        )}
      </For>
    </Show>
  )
}

export function OrchestrationDetails(props: {
  node: OrchestrationNode
  server: string
  intelligence?: IntelligenceStatus
  evaluations?: readonly IntelligenceEvaluation[]
  loading: boolean
  error: boolean
}) {
  const theme = useTheme()
  const model = (ref: SessionInfo["model"]) => (ref ? `${ref.providerID} / ${ref.id}` : "Not recorded")
  return (
    <box gap={1} flexShrink={0}>
      <box>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {props.node.session.title || props.node.session.id}
        </text>
        <text fg={theme.text.muted}>
          {orchestrationState(props.node)}
          {props.node.session.agent ? ` · ${props.node.session.agent}` : ""}
        </text>
      </box>
      <box>
        <text fg={theme.text.base}>Model: {model(props.node.session.model)}</text>
        <text fg={theme.text.muted}>Checkout: {props.node.session.location.directory}</text>
        <text fg={theme.text.muted}>Server: {props.server}</text>
      </box>
      <box>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Usage · selected session
        </text>
        <text fg={theme.text.muted}>
          {Locale.number(props.node.session.tokens.input)} input · {Locale.number(props.node.session.tokens.output)}{" "}
          output · {Locale.number(props.node.session.tokens.cache.read)} cache read · $
          {props.node.session.cost.toFixed(4)}
        </text>
        <Show when={SubagentReview.read(props.node.session.metadata)?.result}>
          {(result) => <text fg={theme.text.base}>Review: {SubagentReview.LABEL[result().decision]}</text>}
        </Show>
      </box>
      <box>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Quality checks · S1
        </text>
        <Show
          when={!props.error && !props.loading}
          fallback={<text fg={theme.text.muted}>{props.loading ? "Loading checks…" : "Checks unavailable."}</text>}
        >
          <text fg={theme.text.muted}>
            Evaluator:{" "}
            {props.intelligence?.effective.reasoning === "single"
              ? "Off · single reasoning"
              : (props.intelligence?.settings.evaluator?.model ?? "Not configured")}
          </text>
          <For each={props.evaluations?.slice(0, 6)}>
            {(item) => (
              <text fg={item.decision === "needs_revision" ? theme.text.feedback.warning.base : theme.text.muted}>
                {Locale.time(item.created)} · {Locale.titlecase(item.decision.replaceAll("_", " "))} ·{" "}
                {item.operation.replaceAll("_", " ")} · {Math.round(item.duration)}ms
              </text>
            )}
          </For>
          <Show when={!props.evaluations?.length}>
            <text fg={theme.text.muted}>No recorded checks.</text>
          </Show>
        </Show>
      </box>
      <Show when={!props.error && !props.loading && props.intelligence?.settings.fast}>
        {(support) => <text fg={theme.text.muted}>Support model: {model(support())}</text>}
      </Show>
    </box>
  )
}

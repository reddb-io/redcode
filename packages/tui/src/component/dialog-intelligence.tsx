import type { IntelligenceStatus } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { createResource, onCleanup } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"

export function DialogIntelligence(props: { context: Plugin.Context; setup: () => void }) {
  const theme = useTheme().surface("dialog")
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const [status] = createResource(() => props.context.client["server.intelligence"].status({ signal: abort.signal }))
  const route = props.context.ui.router.current()
  const [history] = createResource(async () =>
    route.type === "session"
      ? props.context.client["server.intelligence"].history(
          { sessionID: route.sessionID, limit: 30 },
          { signal: abort.signal },
        )
      : [],
  )
  const model = () => props.context.ui.model.current()
  const description = () => {
    if (status.error) return errorMessage(status.error)
    const current = status()
    if (!current) return "Loading reasoning roles…"
    return `${current.effective.reasoning} · mode from ${current.effective.source}\nS2: ${model() ? `${model()!.providerID}/${model()!.modelID} (TUI selection)` : principal(current)}\nGlobal S2: ${principal(current)}\nS1: ${current.settings.evaluator ? `${current.settings.evaluator.transport}/${current.settings.evaluator.model}` : "not configured"}`
  }
  return (
    <DialogSelect
      title="S1 / S2 · Models and evaluations"
      options={[
        { value: "setup", title: "Configure reasoning roles", description: "/setup" },
        ...(history.error ? [] : (history() ?? [])).map((evaluation) => ({
          value: evaluation.id,
          title: `${evaluation.operation} · ${evaluation.decision}`,
          description: evaluation.issues.join(" · ") || evaluation.model,
          footer: new Date(evaluation.created).toLocaleTimeString(),
          category: "Session evaluations",
        })),
      ]}
      titleView={<text fg={theme.text.base}>{description()}</text>}
      footer={
        <text fg={history.error ? theme.text.feedback.error.base : theme.text.muted}>
          {history.error
            ? errorMessage(history.error)
            : history.loading
              ? "Loading evaluations…"
              : "Select an evaluation to inspect its answers and issues."}
        </text>
      }
      onSelect={(option) => {
        if (option.value === "setup") return props.setup()
        const evaluation = history()?.find((item) => item.id === option.value)
        if (!evaluation) return
        void props.context.ui.dialog.alert({
          title: `${evaluation.operation} · ${evaluation.decision}`,
          message: `${evaluation.model}\n${evaluation.issues.join("\n")}\n${JSON.stringify(evaluation.answers, null, 2)}`,
        })
      }}
    />
  )
}

function principal(status: IntelligenceStatus) {
  return status.settings.principal
    ? `${status.settings.principal.providerID}/${status.settings.principal.id}`
    : "not configured"
}

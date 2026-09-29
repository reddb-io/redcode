import type { Plugin } from "@opencode/plugin/tui"
import { createResource, onCleanup } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useLocal } from "../context/local"
import { evaluatorModelName, evaluatorTransportName } from "../util/intelligence-label"
import { modelLabel } from "../util/model-presentation"

export function DialogIntelligence(props: { context: Plugin.Context; setup: () => void }) {
  const theme = useTheme().surface("dialog")
  const local = useLocal()
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
    const selected = model()
    const location = props.context.location ?? props.context.data.location.default()
    const providers = props.context.data.location.provider.list(location) ?? []
    const models = props.context.data.location.model.list(location) ?? []
    const describe = (ref: { providerID: string; id: string } | undefined) => {
      if (!ref) return "not configured"
      const provider = providers.find((item) => item.id === ref.providerID)
      const info = models.find((item) => item.providerID === ref.providerID && item.id === ref.id)
      return info ? modelLabel(info, providers) : `${provider?.name ?? ref.providerID} · ${ref.id} (unavailable)`
    }
    const s1 =
      current.effective.reasoning === "dual"
        ? current.settings.evaluator
          ? `${evaluatorTransportName(current.settings.evaluator.transport)} · ${evaluatorModelName(current.settings.evaluator.model)}`
          : "not configured"
        : "off"
    return `${current.effective.reasoning === "dual" ? "Dual" : "Single"} reasoning · ${current.effective.source}${current.effective.source === "flag" ? ` (${current.environment})` : ""}\nS2 current: ${describe(selected && { providerID: selected.providerID, id: selected.modelID })} (${local.model.source()})\nS2 default: ${describe(current.settings.principal)}\nS2 transformations: ${current.settings.fast ? describe(current.settings.fast) : "reuse default"}\nS1 evaluator: ${s1}`
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

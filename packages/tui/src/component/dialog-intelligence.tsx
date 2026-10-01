import type { Plugin } from "@opencode/plugin/tui"
import { createResource, onCleanup } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useClipboard } from "../context/clipboard"
import { useLocal } from "../context/local"
import { evaluatorModelName, evaluatorTransportName } from "../util/intelligence-label"
import { modelLabel } from "../util/model-presentation"

export function DialogIntelligence(props: { context: Plugin.Context; setup: () => void }) {
  const theme = useTheme().surface("dialog")
  const local = useLocal()
  const clipboard = useClipboard()
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const route = props.context.ui.router.current()
  const [status] = createResource(() =>
    props.context.client["server.intelligence"].status(
      { sessionID: route.type === "session" ? route.sessionID : undefined },
      { signal: abort.signal },
    ),
  )
  const [history] = createResource(async () =>
    route.type === "session"
      ? props.context.client["server.intelligence"].history(
          { sessionID: route.sessionID, limit: 30 },
          { signal: abort.signal },
        )
      : [],
  )
  const [artifacts, { refetch }] = createResource(async () =>
    route.type === "session"
      ? props.context.client["server.intelligence"].artifacts({ sessionID: route.sessionID }, { signal: abort.signal })
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
      current.effective.reasoning !== "single"
        ? current.settings.evaluator
          ? `${evaluatorTransportName(current.settings.evaluator.transport)} · ${evaluatorModelName(current.settings.evaluator.model)}`
          : "not configured"
        : "off"
    return `${current.effective.reasoning === "observe" ? "Observe" : current.effective.reasoning === "dual" ? "Dual" : "Single"} reasoning · ${current.effective.source}${current.effective.source === "flag" ? ` (${current.environment})` : ""}\nS2 current: ${describe(selected && { providerID: selected.providerID, id: selected.modelID })} (${local.model.source()})\nS2 default: ${describe(current.settings.principal)}\nS2 transformations: ${current.settings.fast ? describe(current.settings.fast) : "reuse default"}\nS1 evaluator: ${s1}`
  }
  return (
    <DialogSelect
      title="S1 / S2 · Models and evaluations"
      options={[
        { value: "setup", title: "Configure reasoning roles", description: "/setup" },
        ...(artifacts.error ? [] : (artifacts() ?? [])).map((artifact) => ({
          value: `artifact:${artifact.id}`,
          title:
            artifact.type === "curation"
              ? `Context curation · ${artifact.omitted.length} blocks`
              : `Learning · ${artifact.status}`,
          description:
            artifact.type === "curation"
              ? artifact.omitted.map((item) => item.messageID).join(" · ")
              : artifact.proposal,
          category: "Session artifacts",
        })),
        ...(history.error ? [] : (history() ?? [])).map((evaluation) => ({
          value: evaluation.id,
          title: `${evaluation.operation} · ${evaluation.mode ?? "dual"} · ${evaluation.decision}`,
          description: `${Math.round(evaluation.duration)}ms · ${evaluation.usage.input_tokens + evaluation.usage.output_tokens} tokens · ${evaluation.usage.cost === undefined ? "cost unknown" : `$${evaluation.usage.cost.toFixed(5)}`}${evaluation.usage.unpriced ? " + unknown cost" : ""} · ${evaluation.issues.join(" · ") || evaluation.model}`,
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
        const artifact = artifacts()?.find((item) => `artifact:${item.id}` === option.value)
        if (artifact && route.type === "session") {
          void props.context.ui.dialog
            .select({
              title: artifact.type === "learning" ? "Learning candidate" : "Context curation",
              options: [
                { value: "inspect" as const, title: "Inspect provenance and evidence" },
                { value: "export" as const, title: "Copy JSON for review/export" },
                ...(artifact.type === "learning"
                  ? [
                      {
                        value: "approved" as const,
                        title: "Approve for export",
                        description: "Does not install a memory or skill",
                      },
                      { value: "rejected" as const, title: "Reject candidate" },
                    ]
                  : []),
              ],
            })
            .then(async (action) => {
              if (action === "inspect")
                await props.context.ui.dialog.alert({
                  title: artifact.type,
                  message: JSON.stringify(artifact, null, 2),
                })
              if (action === "export") await clipboard.write(JSON.stringify(artifact, null, 2))
              if (action === "approved" || action === "rejected") {
                await props.context.client["server.intelligence"].reviewLearning(
                  { sessionID: route.sessionID, id: artifact.id, status: action },
                  { signal: abort.signal },
                )
                await refetch()
              }
            })
            .catch((error) => props.context.ui.toast.show({ variant: "error", message: errorMessage(error) }))
          return
        }
        const evaluation = history()?.find((item) => item.id === option.value)
        if (!evaluation) return
        void props.context.client["server.intelligence"]
          .evidence(
            { sessionID: route.type === "session" ? route.sessionID : "", id: evaluation.id },
            { signal: abort.signal },
          )
          .then((evidence) =>
            props.context.ui.dialog.alert({
              title: `${evaluation.operation} · ${evaluation.mode ?? "dual"} · ${evaluation.decision}`,
              message: JSON.stringify(evidence, null, 2),
            }),
          )
          .catch((error) => props.context.ui.toast.show({ variant: "error", message: errorMessage(error) }))
      }}
    />
  )
}

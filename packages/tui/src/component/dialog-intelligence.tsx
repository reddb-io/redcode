import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTerminalDimensions } from "@opentui/solid"
import { IntelligenceClient } from "@reddb-io/redcode-client"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSetup } from "./dialog-setup"

export function IntelligenceIndicator(props: { sessionID?: string }) {
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const theme = useTheme().theme
  const dialog = useDialog()
  const [state, set] = createStore({ evaluation: undefined as Intelligence.Evaluation | undefined, failed: false })
  createEffect(() => {
    const sessionID = props.sessionID
    const activity = sessionID ? sync.data.session_status[sessionID]?.type : undefined
    void activity
    const abort = new AbortController()
    onCleanup(() => abort.abort())
    set({ evaluation: undefined, failed: false })
    if (!sessionID) return
    const api = IntelligenceClient.make({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      headers: sdk.headers,
      signal: abort.signal,
    })
    void api
      .history({ sessionID, limit: 1 })
      .then((history) => {
        if (!Array.isArray(history)) throw new Error("Invalid evaluation history")
        if (!abort.signal.aborted) set("evaluation", history[0])
      })
      .catch(() => {
        if (!abort.signal.aborted) set("failed", true)
      })
  })
  const single = () => local.intelligence.reasoning() === "single"
  const warning = () =>
    !local.intelligence.ready() ||
    (!single() && (state.failed || (state.evaluation && state.evaluation.decision !== "accepted")))
  const label = () => {
    if (single()) return "Single"
    if (!local.intelligence.ready()) return "S1 Setup"
    // The S2 model is already shown before this indicator; name the S1 evaluator here.
    const model = local.intelligence.state.status?.settings.evaluator?.model
    return model ? `S1 ${model.split("/").at(-1)}` : "S1 · S2"
  }
  return (
    <text
      fg={warning() ? theme.warning : theme.textMuted}
      onMouseUp={() => dialog.replace(() => <DialogIntelligence sessionID={props.sessionID} />)}
    >
      · {label()}
      {warning() ? " !" : ""}
    </text>
  )
}

export function DialogIntelligence(props: { sessionID?: string }) {
  const local = useLocal()
  const sdk = useSDK()
  const theme = useTheme().theme
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const abort = new AbortController()
  const api = IntelligenceClient.make({
    baseUrl: sdk.url,
    fetch: sdk.fetch,
    headers: sdk.headers,
    signal: abort.signal,
  })
  const [state, set] = createStore({ evaluations: [] as readonly Intelligence.Evaluation[], loading: true, error: "" })
  onCleanup(() => abort.abort())
  const refresh = async () => {
    set({ loading: true, error: "" })
    await local.intelligence.refresh()
    if (!props.sessionID) return set("loading", false)
    await api
      .history({ sessionID: props.sessionID, limit: 20 })
      .then((evaluations) => {
        if (!Array.isArray(evaluations)) throw new Error("Invalid evaluation history")
        if (!abort.signal.aborted) set({ evaluations, loading: false })
      })
      .catch(() => {
        if (!abort.signal.aborted)
          set({ error: "Could not load this session's evaluations. Retry to refresh.", loading: false })
      })
  }
  createEffect(() => void refresh())
  const settings = () => local.intelligence.state.status?.settings
  const current = () => local.model.current()
  const override = () =>
    current()?.providerID !== settings()?.principal?.providerID || current()?.modelID !== settings()?.principal?.id
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>{local.intelligence.reasoning() === "single" ? "Single reasoning" : "Dual reasoning · S1 · S2"}</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={local.intelligence.ready() ? theme.textMuted : theme.warning} wrapMode="word">
        {local.intelligence.state.error ||
          (local.intelligence.reasoning() === "single"
            ? `S2 only; completion gates keep their structural checks and report S1 as not verified.${local.intelligence.state.status?.effective.source === "flag" ? " Set for this run by --reasoning." : " Run /setup to enable dual reasoning (S1 + S2)."}`
            : local.intelligence.ready()
              ? "Configured. Connection health is reported by each evaluation."
              : "Setup required before sending prompts.")}
      </text>
      <text fg={theme.text} wrapMode="word">
        S1 · evaluator: {settings()?.evaluator?.model ?? "Not configured"}
      </text>
      <Show when={settings()?.evaluator}>
        {(value) => (
          <text fg={theme.textMuted} wrapMode="word">
            {value().transport} · {value().baseURL}
          </text>
        )}
      </Show>
      <text fg={theme.text} wrapMode="word">
        S2 · working model: {current() ? `${current()!.providerID}/${current()!.modelID}` : "Not selected"}
      </text>
      <text fg={theme.textMuted}>{override() ? "Session / agent override" : "Global principal"}</text>
      <text fg={theme.textMuted} wrapMode="word">
        Global S2:{" "}
        {settings()?.principal ? `${settings()!.principal!.providerID}/${settings()!.principal!.id}` : "Not configured"}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        Transformations:{" "}
        {settings()?.fast ? `${settings()!.fast!.providerID}/${settings()!.fast!.id}` : "Reuse global S2"}
      </text>
      <box flexDirection="row" gap={3}>
        <text fg={theme.primary} onMouseUp={() => dialog.replace(() => <DialogSetup />)}>
          Configure /setup
        </text>
        <text fg={theme.primary} onMouseUp={() => void refresh()}>
          Refresh
        </text>
      </box>
      <text fg={theme.text}>
        <b>Session evaluations</b>
      </text>
      <Show when={state.loading}>
        <text fg={theme.textMuted}>Loading…</text>
      </Show>
      <Show when={state.error}>
        <text fg={theme.error} wrapMode="word">
          {state.error}
        </text>
      </Show>
      <Show when={!state.loading && !state.error && state.evaluations.length === 0}>
        <text fg={theme.textMuted}>
          {props.sessionID ? "No evaluations recorded for this session." : "Send a prompt to start a session."}
        </text>
      </Show>
      <scrollbox maxHeight={Math.max(3, dimensions().height - 21)}>
        <For each={state.evaluations}>
          {(evaluation) => (
            <box paddingBottom={1}>
              <text fg={evaluation.decision === "accepted" ? theme.text : theme.warning} wrapMode="word">
                {evaluation.operation.replaceAll("_", " ")} · {evaluation.decision.replaceAll("_", " ")}
              </text>
              <text fg={theme.textMuted} wrapMode="word">
                {evaluation.model} · {new Date(evaluation.created).toLocaleTimeString()} · {evaluation.duration} ms ·{" "}
                {evaluation.usage.input_tokens + evaluation.usage.output_tokens} tokens
              </text>
              <Show when={evaluation.subjectID}>
                <text fg={theme.textMuted} wrapMode="word">
                  Prompt: {evaluation.subjectID}
                </text>
              </Show>
              <Show when={evaluation.issues.length}>
                <text fg={theme.warning} wrapMode="word">
                  {evaluation.issues.join(" · ")}
                </text>
              </Show>
              <For each={Object.entries(evaluation.answers)}>
                {([key, answer]) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {key}:{" "}
                    {answer.type === "noul"
                      ? `noul ${answer.noul.toFixed(2)}`
                      : `${answer.type === "choice" ? answer.choice : answer.score} (confidence ${answer.confidence.toFixed(2)})`}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

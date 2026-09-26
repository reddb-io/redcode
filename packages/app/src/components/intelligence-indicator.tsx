import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Button } from "@reddb-io/redcode-ui/button"
import { Popover } from "@reddb-io/redcode-ui/popover"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import type { ModelSelection } from "@/context/local"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useSettingsDialog } from "./settings-dialog"

export function IntelligenceIndicator(props: { model: ModelSelection; sessionID?: string }) {
  const server = useServerSDK()
  const sync = useSync()
  const params = useParams<{ id?: string }>()
  const configure = useSettingsDialog("intelligence")
  const [state, set] = createStore({
    open: false,
    loading: false,
    failed: false,
    evaluations: [] as readonly Intelligence.Evaluation[],
  })
  const sessionID = () => props.sessionID ?? params.id
  const intelligence = () => server().intelligence
  const settings = () => intelligence().state.status?.settings
  const current = () => props.model.current()
  const override = () =>
    current()?.provider.id !== settings()?.principal?.providerID || current()?.id !== settings()?.principal?.id
  const latest = () => state.evaluations[0]
  const single = () => intelligence().state.loaded && intelligence().reasoning() === "single"
  const attention = () =>
    intelligence().state.failed ||
    !intelligence().ready() ||
    (!single() &&
      (state.failed ||
        latest()?.decision === "unavailable" ||
        latest()?.decision === "needs_revision" ||
        latest()?.decision === "inconclusive"))
  const status = () =>
    !intelligence().state.loaded
      ? "Checking…"
      : intelligence().state.failed
        ? "Cannot check the S1/S2 configuration. Reconnect and retry."
        : single()
          ? "Single reasoning: S2 only. Completion checks keep their structural evidence and report S1 as not verified."
          : !intelligence().ready()
            ? "Configure S1 and S2 to continue"
            : latest()
              ? (decisionText[latest()!.decision] ?? latest()!.decision)
              : "Configured. Connection health is reported by each evaluation."
  createEffect(() => {
    const id = sessionID()
    const service = intelligence()
    const activity = id ? sync().data.session_status[id]?.type : undefined
    void activity
    const open = state.open
    let active = true
    onCleanup(() => {
      active = false
    })
    if (!id) return set({ evaluations: [], loading: false, failed: false })
    set({ evaluations: [], loading: true, failed: false })
    void service
      .history({ sessionID: id, limit: open ? 20 : 1 })
      .then((evaluations) => {
        if (active) set({ evaluations, loading: false })
      })
      .catch(() => {
        if (active) set({ loading: false, failed: true })
      })
  })
  return (
    <Popover
      open={state.open}
      onOpenChange={(open) => {
        set("open", open)
        if (open) void intelligence().refresh()
      }}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        size: "normal",
        class: "min-w-0 max-w-[100px] sm:max-w-[160px] h-7 text-12-regular text-text-weak",
        "data-action": "prompt-intelligence",
        "aria-label": "System One / System Two",
        title: single()
          ? status()
          : `${"S1 · evaluator"}: ${settings()?.evaluator?.model ?? status()}`,
      }}
      trigger={
        <>
          <span classList={{ "text-icon-warning-base": attention() }}>
            {single()
              ? "Single"
              : settings()?.evaluator?.model
                ? `S1 ${settings()!.evaluator!.model.split("/").at(-1)}`
                : "S1 · S2"}
          </span>
          <Show when={!single() && !intelligence().ready()}>
            <span class="truncate">{"Set up"}</span>
          </Show>
          <Show when={attention()}>
            <span aria-label={status()}>!</span>
          </Show>
        </>
      }
      title={"System One / System Two"}
      class="w-[380px] max-w-[calc(100vw-24px)]"
      placement="top-start"
    >
      <div class="flex flex-col gap-4 text-12-regular">
        <p role="status" classList={{ "text-icon-warning-base": attention() }}>
          {status()}
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Show when={!single()}>
            <dt class="text-text-weak">{"S1 · evaluator"}</dt>
            <dd class="min-w-0 break-words">
              {settings()?.evaluator?.model ?? "Configure S1 and S2 to continue"}
              <div class="text-text-weak">{settings()?.evaluator?.transport}</div>
            </dd>
          </Show>
          <dt class="text-text-weak">{"S2 · working model"}</dt>
          <dd class="min-w-0 break-words">
            {current() ? `${current()!.provider.name} / ${current()!.name}` : "Select model"}
            <div class="text-text-weak">
              {override() ? "Session or agent override" : "Global S2 default"}
            </div>
          </dd>
          <dt class="text-text-weak">{"Global S2 default"}</dt>
          <dd class="min-w-0 break-words">
            {settings()?.principal
              ? `${settings()!.principal!.providerID}/${settings()!.principal!.id}`
              : "Configure S1 and S2 to continue"}
          </dd>
        </dl>
        <Button
          variant="secondary"
          onClick={() => {
            set("open", false)
            configure()
          }}
        >
          {single() ? "Enable dual reasoning (S1 + S2)" : "Configure"}
        </Button>
        <div class="border-t border-border-base pt-3">
          <h3 class="text-12-medium mb-2">{"Session evaluations"}</h3>
          <Show when={state.loading}>
            <p role="status">{"Checking…"}</p>
          </Show>
          <Show when={state.failed}>
            <p role="status">{"Could not load evaluations. Reopen to retry."}</p>
          </Show>
          <Show when={!state.loading && !state.failed && !state.evaluations.length}>
            <p class="text-text-weak">{"No evaluations recorded for this session."}</p>
          </Show>
          <div class="max-h-64 overflow-y-auto">
            <For each={state.evaluations}>
              {(evaluation) => (
                <details class="border-b border-border-base py-2">
                  <summary class="cursor-pointer">
                    {operationText[evaluation.operation] ?? evaluation.operation} ·{" "}
                    {decisionText[evaluation.decision] ?? evaluation.decision}
                  </summary>
                  <div class="pt-2 flex flex-col gap-1 break-words text-text-weak">
                    <p>
                      {evaluation.model} · {new Date(evaluation.created).toLocaleTimeString()}
                    </p>
                    <p>
                      {`${evaluation.usage.input_tokens} input tokens · ${evaluation.usage.output_tokens} output tokens · ${evaluation.duration} ms`}
                    </p>
                    <Show when={evaluation.subjectID}>
                      <p>{`Prompt: ${evaluation.subjectID!}`}</p>
                    </Show>
                    <For each={evaluation.issues}>{(issue) => <p class="text-icon-warning-base">{issue}</p>}</For>
                    <For each={Object.entries(evaluation.answers)}>
                      {([key, answer]) => (
                        <p>
                          {key}:{" "}
                          {answer.type === "noul"
                            ? `noul ${answer.noul.toFixed(2)}`
                            : `${answer.type === "choice" ? answer.choice : answer.score} (${answer.confidence.toFixed(2)})`}
                        </p>
                      )}
                    </For>
                  </div>
                </details>
              )}
            </For>
          </div>
        </div>
      </div>
    </Popover>
  )
}

const operationText: Record<string, string> = {
  prompt_classification: "Prompt classification",
  response_quality: "Response quality",
  tool_usage: "Tool usage",
  task_quality: "Task quality",
  todos: "Tasks",
  plan: "Plan",
  feedback: "Design feedback",
  design_completion: "Design completion",
  compaction: "Checkpoint summary",
  compact_now: "Compaction timing",
  task_completion: "Task completion",
  goal_completion: "Goal completion",
  subagent_brief: "Subagent brief",
  session_progress: "Session progress",
  subagent_result: "Subagent result",
  design_target: "Design target",
  design_system_detect: "Design system",
  goal_command: "Goal command",
}

const decisionText: Record<string, string> = {
  accepted: "Accepted",
  needs_revision: "Needs revision",
  inconclusive: "Inconclusive",
  unavailable: "Unavailable",
}

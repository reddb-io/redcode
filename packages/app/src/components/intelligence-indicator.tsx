import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Button } from "@reddb-io/redcode-ui/button"
import { Popover } from "@reddb-io/redcode-ui/popover"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import type { ModelSelection } from "@/context/local"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSettingsDialog } from "./settings-dialog"

export function IntelligenceIndicator(props: { model: ModelSelection; sessionID?: string }) {
  const server = useServerSDK()
  const sync = useSync()
  const params = useParams<{ id?: string }>()
  const language = useLanguage()
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
    language.t(
      !intelligence().state.loaded
        ? "intelligence.loading"
        : intelligence().state.failed
          ? "intelligence.connectionFailed"
          : single()
            ? "intelligence.singleStatus"
            : !intelligence().ready()
              ? "intelligence.setupRequired"
              : latest()
                ? `settings.intelligence.decision.${latest()!.decision}`
                : "intelligence.configured",
    )
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
        "aria-label": language.t("intelligence.details"),
        title: single()
          ? status()
          : `${language.t("intelligence.systemOne")}: ${settings()?.evaluator?.model ?? status()}`,
      }}
      trigger={
        <>
          <span classList={{ "text-icon-warning-base": attention() }}>
            {single() ? language.t("intelligence.mode.single") : "S1 · S2"}
          </span>
          <Show when={!single() && !intelligence().ready()}>
            <span class="truncate">{language.t("intelligence.setup")}</span>
          </Show>
          <Show when={attention()}>
            <span aria-label={status()}>!</span>
          </Show>
        </>
      }
      title={language.t("intelligence.details")}
      class="w-[380px] max-w-[calc(100vw-24px)]"
      placement="top-start"
    >
      <div class="flex flex-col gap-4 text-12-regular">
        <p role="status" classList={{ "text-icon-warning-base": attention() }}>
          {status()}
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Show when={!single()}>
            <dt class="text-text-weak">{language.t("intelligence.systemOne")}</dt>
            <dd class="min-w-0 break-words">
              {settings()?.evaluator?.model ?? language.t("intelligence.setupRequired")}
              <div class="text-text-weak">{settings()?.evaluator?.transport}</div>
            </dd>
          </Show>
          <dt class="text-text-weak">{language.t("intelligence.systemTwo")}</dt>
          <dd class="min-w-0 break-words">
            {current() ? `${current()!.provider.name} / ${current()!.name}` : language.t("dialog.model.select.title")}
            <div class="text-text-weak">
              {language.t(override() ? "intelligence.override" : "intelligence.globalDefault")}
            </div>
          </dd>
          <dt class="text-text-weak">{language.t("intelligence.globalDefault")}</dt>
          <dd class="min-w-0 break-words">
            {settings()?.principal
              ? `${settings()!.principal!.providerID}/${settings()!.principal!.id}`
              : language.t("intelligence.setupRequired")}
          </dd>
          <dt class="text-text-weak">{language.t("intelligence.transformations")}</dt>
          <dd class="min-w-0 break-words">
            {settings()?.fast
              ? `${settings()!.fast!.providerID}/${settings()!.fast!.id}`
              : language.t("intelligence.reuseS2")}
          </dd>
        </dl>
        <Button
          variant="secondary"
          onClick={() => {
            set("open", false)
            configure()
          }}
        >
          {language.t(single() ? "intelligence.enableDual" : "settings.intelligence.configure")}
        </Button>
        <div class="border-t border-border-base pt-3">
          <h3 class="text-12-medium mb-2">{language.t("intelligence.sessionHistory")}</h3>
          <Show when={state.loading}>
            <p role="status">{language.t("intelligence.loading")}</p>
          </Show>
          <Show when={state.failed}>
            <p role="status">{language.t("intelligence.historyFailed")}</p>
          </Show>
          <Show when={!state.loading && !state.failed && !state.evaluations.length}>
            <p class="text-text-weak">{language.t("intelligence.emptyHistory")}</p>
          </Show>
          <div class="max-h-64 overflow-y-auto">
            <For each={state.evaluations}>
              {(evaluation) => (
                <details class="border-b border-border-base py-2">
                  <summary class="cursor-pointer">
                    {language.t(`settings.intelligence.operation.${evaluation.operation}`)} ·{" "}
                    {language.t(`settings.intelligence.decision.${evaluation.decision}`)}
                  </summary>
                  <div class="pt-2 flex flex-col gap-1 break-words text-text-weak">
                    <p>
                      {evaluation.model} · {new Date(evaluation.created).toLocaleTimeString()}
                    </p>
                    <p>
                      {language.t("settings.intelligence.usage", {
                        input: evaluation.usage.input_tokens,
                        output: evaluation.usage.output_tokens,
                        duration: evaluation.duration,
                      })}
                    </p>
                    <Show when={evaluation.subjectID}>
                      <p>{language.t("intelligence.subject", { id: evaluation.subjectID! })}</p>
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

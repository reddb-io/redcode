import type { IntelligenceEvaluation, IntelligenceStatus } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { List } from "@opencode/ui/list"
import { IntelligenceLabel } from "@opencode/util/intelligence-label"
import { createResource, For, Show, type JSX } from "solid-js"
import { useModels } from "@/providers/models/models"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { reasoningChoiceKeys, reasoningChoices } from "./control"
import type { ComposerReasoning } from "./state"

const modeKeys = {
  single: "settings.models.reasoning.mode.single",
  observe: "settings.models.reasoning.mode.observe",
  dual: "settings.models.reasoning.mode.dual",
} as const

const sourceKeys = {
  session: "settings.models.reasoning.source.session",
  flag: "settings.models.reasoning.source.flag",
  config: "settings.models.reasoning.source.config",
  default: "settings.models.reasoning.source.default",
} as const

/** Picks the session's reasoning mode from the command palette, like the TUI's `/reasoning`. */
export function DialogReasoningMode(props: { reasoning: ComposerReasoning }) {
  const dialog = useDialog()
  const language = useLanguage()
  const items = reasoningChoices.map((choice) => ({ choice, title: language.t(reasoningChoiceKeys[choice]) }))

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{language.t("command.reasoning.mode")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <List
          class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
          key={(item) => item.choice}
          items={items}
          current={items.find((item) => item.choice === props.reasoning.override())}
          activeIcon="check"
          onSelect={(item) => {
            if (!item) return
            props.reasoning.set(item.choice)
            dialog.close()
          }}
        >
          {(item) => <span class="truncate text-left font-normal">{item.title}</span>}
        </List>
      </DialogBody>
    </Dialog>
  )
}

/**
 * The session's S1 / S2 roles and evaluations, like the TUI's `/intelligence`: the effective mode and where it comes
 * from, the S2 models, the S1 evaluator, and the session's latest evaluations.
 */
export function DialogIntelligence(props: { sessionID?: string; model: ModelSelection; onSetup: () => void }) {
  const language = useLanguage()
  const server = useServerSDK()
  const models = useModels()
  const api = server.api["server.intelligence"]
  const [status] = createResource(() => api.status({ sessionID: props.sessionID }))
  const [history] = createResource(async () =>
    props.sessionID ? api.history({ sessionID: props.sessionID, limit: 30 }) : [],
  )
  // Reading an unresolved resource would suspend the dialog, so only settled values are read.
  const current = () => (status.state === "ready" ? status.latest : undefined)
  const evaluations = () => (history.state === "ready" ? history.latest : undefined)

  const describe = (ref: { providerID: string; id: string } | undefined) => {
    if (!ref) return language.t("settings.models.reasoning.unset")
    const found = models.find({ providerID: ref.providerID, modelID: ref.id })

    return found
      ? `${found.provider.name} · ${found.name}`
      : language.t("composer.reasoning.dialog.unavailableModel", { provider: ref.providerID, model: ref.id })
  }

  const s1 = (value: IntelligenceStatus) => {
    if (value.effective.reasoning === "single") return language.t("composer.reasoning.dialog.off")
    const evaluator = value.settings.evaluator

    if (!evaluator) return language.t("settings.models.reasoning.unset")

    return `${IntelligenceLabel.transportName(evaluator.transport)} · ${IntelligenceLabel.modelName(evaluator.model)}`
  }

  const source = (value: IntelligenceStatus) =>
    value.effective.source === "flag"
      ? `${language.t(sourceKeys.flag)} (${value.environment})`
      : language.t(sourceKeys[value.effective.source])

  const selected = () => {
    const model = props.model.current()

    return model ? `${model.provider.name} · ${model.name}` : language.t("settings.models.reasoning.unset")
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{language.t("composer.reasoning.dialog.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
          <Show
            when={current()}
            fallback={
              <p class="text-body text-ink-muted">
                {status.error
                  ? formatServerError(status.error, language.t, language.t("settings.models.reasoning.unavailable"))
                  : `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`}
              </p>
            }
          >
            {(value) => (
              <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-body">
                <IntelligenceRow
                  name={language.t("settings.models.reasoning.mode")}
                  value={`${language.t(modeKeys[value().effective.reasoning])} · ${source(value())}`}
                />
                <IntelligenceRow name={language.t("composer.reasoning.dialog.s2.current")} value={selected()} />
                <IntelligenceRow
                  name={language.t("settings.models.reasoning.principal")}
                  value={describe(value().settings.principal)}
                />
                <IntelligenceRow
                  name={language.t("settings.models.reasoning.fast")}
                  value={
                    value().settings.fast
                      ? describe(value().settings.fast)
                      : language.t("settings.models.reasoning.fast.reuse")
                  }
                />
                <IntelligenceRow name={language.t("settings.models.reasoning.evaluator")} value={s1(value())} />
              </dl>
            )}
          </Show>
          <div>
            <Button variant="outline" size="normal" onClick={props.onSetup}>
              {language.t("composer.reasoning.dialog.configure")}
            </Button>
          </div>
          <section class="flex flex-col gap-2" aria-label={language.t("composer.reasoning.dialog.evaluations")}>
            <h3 class="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              {language.t("composer.reasoning.dialog.evaluations")}
            </h3>
            <Show
              when={evaluations()}
              fallback={
                <p class="text-body text-ink-muted">
                  {history.error
                    ? formatServerError(history.error, language.t, language.t("common.requestFailed"))
                    : `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`}
                </p>
              }
            >
              {(items) => (
                <Show
                  when={items().length > 0}
                  fallback={<p class="text-body text-ink-muted">{language.t("composer.reasoning.dialog.empty")}</p>}
                >
                  <ul class="flex flex-col divide-y divide-elevation-base-border">
                    <For each={items()}>{(evaluation) => <EvaluationRow evaluation={evaluation} />}</For>
                  </ul>
                </Show>
              )}
            </Show>
          </section>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function IntelligenceRow(props: { name: string; value: JSX.Element }) {
  return (
    <>
      <dt class="text-ink-muted">{props.name}</dt>
      <dd class="min-w-0 break-words text-foreground">{props.value}</dd>
    </>
  )
}

function EvaluationRow(props: { evaluation: IntelligenceEvaluation }) {
  const language = useLanguage()
  const tokens = () => props.evaluation.usage.input_tokens + props.evaluation.usage.output_tokens
  const cost = () => {
    const value = props.evaluation.usage.cost

    if (value === undefined) return language.t("composer.reasoning.dialog.costUnknown")
    const known = `$${value.toFixed(5)}`

    return props.evaluation.usage.unpriced
      ? language.t("composer.reasoning.dialog.costPartial", { cost: known })
      : known
  }

  return (
    <li class="flex flex-col gap-0.5 py-2">
      <div class="flex min-w-0 items-baseline gap-3">
        {/* Operation, mode and decision are the server's identifiers, shown as the TUI shows them. */}
        <span class="min-w-0 truncate font-mono text-[12px] text-foreground">
          {`${props.evaluation.operation} · ${props.evaluation.mode ?? "dual"} · ${props.evaluation.decision}`}
        </span>
        <span class="ms-auto shrink-0 text-caption tabular-nums text-ink-muted">
          {new Date(props.evaluation.created).toLocaleTimeString(language.intl(), { timeStyle: "short" })}
        </span>
      </div>
      <div class="min-w-0 break-words text-caption text-ink-muted">
        {language.t("composer.reasoning.dialog.evaluation", {
          duration: Math.round(props.evaluation.duration).toLocaleString(language.intl()),
          tokens: tokens().toLocaleString(language.intl()),
          cost: cost(),
          detail: props.evaluation.issues.join(" · ") || props.evaluation.model,
        })}
      </div>
    </li>
  )
}

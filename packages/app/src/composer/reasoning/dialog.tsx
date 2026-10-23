import type { IntelligenceStatus } from "@opencode/client"
import { IntelligenceLabel } from "@opencode/util/intelligence-label"
import { createResource } from "solid-js"
import { useModels } from "@/providers/models/models"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { useNativeDialog } from "@/runtime/react/dialog"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { reasoningChoiceKeys, reasoningChoices } from "./options"
import type { ComposerReasoning } from "./state"
import { IntelligenceDialog, ReasoningModeDialog } from "./dialog.react"

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

export function createReasoningModeServices(props: { reasoning: ComposerReasoning }) {
  const dialog = useNativeDialog()
  const language = useLanguage()
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      open: dialog.open(),
      choice: props.reasoning.override(),
      choices: reasoningChoices.map((choice) => ({ id: choice, label: language.t(reasoningChoiceKeys[choice]) })),
    })),
    select: (value: string) => {
      const choice = reasoningChoices.find((item) => item === value)
      if (!choice) return
      props.reasoning.set(choice)
      dialog.close()
    },
    close: dialog.close,
  }
}

/** The command palette and composer share the same reasoning choices. */
export function DialogReasoningMode(props: Parameters<typeof createReasoningModeServices>[0]) {
  const services = createReasoningModeServices(props)
  return <ReactView component={ReasoningModeDialog} props={{ services }} />
}

export function createIntelligenceDialogServices(props: {
  sessionID?: string
  model: ModelSelection
  onSetup: () => void
}) {
  const language = useLanguage()
  const server = useServerSDK()
  const models = useModels()
  const dialog = useNativeDialog()
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

  return {
    snapshot: sharedSource(() => {
      const value = current()
      return {
        language: sharedLanguage(language),
        open: dialog.open(),
        rows: value
          ? [
              {
                name: language.t("settings.models.reasoning.mode"),
                value: `${language.t(modeKeys[value.effective.reasoning])} · ${source(value)}`,
              },
              { name: language.t("composer.reasoning.dialog.s2.current"), value: selected() },
              { name: language.t("settings.models.reasoning.principal"), value: describe(value.settings.principal) },
              {
                name: language.t("settings.models.reasoning.fast"),
                value: value.settings.fast
                  ? describe(value.settings.fast)
                  : language.t("settings.models.reasoning.fast.reuse"),
              },
              { name: language.t("settings.models.reasoning.evaluator"), value: s1(value) },
            ]
          : undefined,
        status: status.error
          ? formatServerError(status.error, language.t, language.t("settings.models.reasoning.unavailable"))
          : `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`,
        evaluations: evaluations()?.map((evaluation) => {
          const cost = evaluation.usage.cost
          const known = cost === undefined ? undefined : `$${cost.toFixed(5)}`
          return {
            operation: `${evaluation.operation} · ${evaluation.mode ?? "dual"} · ${evaluation.decision}`,
            created: new Date(evaluation.created).toLocaleTimeString(language.intl(), { timeStyle: "short" }),
            detail: language.t("composer.reasoning.dialog.evaluation", {
              duration: Math.round(evaluation.duration).toLocaleString(language.intl()),
              tokens: (evaluation.usage.input_tokens + evaluation.usage.output_tokens).toLocaleString(language.intl()),
              cost:
                known === undefined
                  ? language.t("composer.reasoning.dialog.costUnknown")
                  : evaluation.usage.unpriced
                    ? language.t("composer.reasoning.dialog.costPartial", { cost: known })
                    : known,
              detail: evaluation.issues.join(" · ") || evaluation.model,
            }),
          }
        }),
        history: history.error
          ? formatServerError(history.error, language.t, language.t("common.requestFailed"))
          : `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`,
      }
    }),
    close: dialog.close,
    setup: () => props.onSetup(),
  }
}

/** The existing service owns scoped requests; React owns the status and evaluation view. */
export function DialogIntelligence(props: Parameters<typeof createIntelligenceDialogServices>[0]) {
  const services = createIntelligenceDialogServices(props)
  return <ReactView component={IntelligenceDialog} props={{ services }} />
}

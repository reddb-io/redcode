import { IntelligenceLabel } from "@opencode/util/intelligence-label"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import type { ComposerReasoning } from "./state"
import { stateKeys, reasoningChoices, reasoningChoiceKeys } from "./options"
import { ReasoningControl } from "./control.react"

export function createReasoningControlServices(props: {
  reasoning: ComposerReasoning
  onStatus: () => void
  onSetup: () => void
}) {
  const language = useLanguage()
  return {
    snapshot: sharedSource(() => {
      const reasoning = props.reasoning
      const evaluator = reasoning.status()?.settings.evaluator
      const state = reasoning.state()
      const label = state
        ? language.t(stateKeys[state])
        : reasoning.mode() !== "dual"
          ? language.t("composer.reasoning.single")
          : evaluator
            ? language.t("composer.reasoning.dual", { model: IntelligenceLabel.modelName(evaluator.model) })
            : language.t("composer.reasoning.dual.unconfigured")
      return {
        language: sharedLanguage(language),
        visible: !reasoning.unsupported() && !!(reasoning.status() || state),
        setup: state === "setup",
        label,
        tone: reasoning.tone(),
        choice: reasoning.override(),
        choices: reasoningChoices.map((choice) => ({ id: choice, label: language.t(reasoningChoiceKeys[choice]) })),
        evaluator:
          reasoning.mode() !== "single" && evaluator
            ? language.t("composer.reasoning.evaluator", {
                name: `${IntelligenceLabel.transportName(evaluator.transport)} · ${IntelligenceLabel.modelName(evaluator.model)}`,
              })
            : undefined,
        draft: reasoning.draft() && reasoning.override() !== "default",
      }
    }),
    select: (choice: string) => {
      const found = reasoningChoices.find((item) => item === choice)
      if (found) props.reasoning.set(found)
    },
    status: () => props.onStatus(),
    setup: () => props.onSetup(),
  }
}

/** Native control; the existing session service owns reasoning and draft admission. */
export function ComposerReasoningControl(props: Parameters<typeof createReasoningControlServices>[0]) {
  const services = createReasoningControlServices(props)
  return <ReactView component={ReasoningControl} props={{ services }} />
}

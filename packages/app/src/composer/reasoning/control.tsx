import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { IntelligenceLabel } from "@opencode/util/intelligence-label"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerReasoning, ReasoningChoice } from "./state"

export const reasoningChoices = ["default", "single", "observe", "dual"] as const satisfies readonly ReasoningChoice[]

export const reasoningChoiceKeys = {
  default: "composer.reasoning.option.default",
  single: "composer.reasoning.option.single",
  observe: "composer.reasoning.option.observe",
  dual: "composer.reasoning.option.dual",
} as const

// The same words as the TUI footer (`IntelligenceLabel.labels`).
const stateKeys = {
  offline: "composer.reasoning.state.offline",
  setup: "composer.reasoning.state.setup",
  observing: "composer.reasoning.state.observing",
  unavailable: "composer.reasoning.state.unavailable",
  unsure: "composer.reasoning.state.unsure",
  flagged: "composer.reasoning.state.flagged",
} as const satisfies Record<IntelligenceLabel.State, string>

/**
 * The session's reasoning mode beside the model: what S1 says (in the TUI's words) or the mode itself, with S1's model
 * while the session runs dual. It opens the mode menu, or the reasoning roles in Settings while they are not set up.
 */
export function ComposerReasoningControl(props: {
  reasoning: ComposerReasoning
  onStatus: () => void
  onSetup: () => void
}) {
  const language = useLanguage()
  const evaluator = () => props.reasoning.status()?.settings.evaluator

  const label = () => {
    const state = props.reasoning.state()

    if (state) return language.t(stateKeys[state])

    if (props.reasoning.mode() !== "dual") return language.t("composer.reasoning.single")
    const current = evaluator()

    return current
      ? language.t("composer.reasoning.dual", { model: IntelligenceLabel.modelName(current.model) })
      : language.t("composer.reasoning.dual.unconfigured")
  }

  const tooltip = () => (
    <div class="flex flex-col gap-0.5">
      <span>{language.t("composer.reasoning.title")}</span>
      <Show when={props.reasoning.mode() !== "single" && evaluator()}>
        {(current) => (
          <span class="text-ink-muted">
            {language.t("composer.reasoning.evaluator", {
              name: `${IntelligenceLabel.transportName(current().transport)} · ${IntelligenceLabel.modelName(current().model)}`,
            })}
          </span>
        )}
      </Show>
      <Show when={props.reasoning.draft() && props.reasoning.override() !== "default"}>
        <span class="text-ink-muted">{language.t("composer.reasoning.draft")}</span>
      </Show>
    </div>
  )

  const content = () => (
    <>
      <Icon name="brain" size="small" class="shrink-0" />
      <span class="truncate leading-5">{label()}</span>
    </>
  )

  const tone = () => ({
    "text-feedback-warning-foreground": props.reasoning.tone() === "warning",
    "text-feedback-info-foreground": props.reasoning.tone() === "info",
  })

  return (
    <Show when={!props.reasoning.unsupported() && (props.reasoning.status() || props.reasoning.state())}>
      <Tooltip placement="top" value={tooltip()}>
        <Show
          when={props.reasoning.state() !== "setup"}
          fallback={
            <Button
              type="button"
              variant="ghost-muted"
              size="normal"
              class="max-w-[220px] justify-start gap-1.5 font-medium"
              aria-label={language.t("composer.reasoning.setup")}
              onClick={props.onSetup}
            >
              {content()}
            </Button>
          }
        >
          <Menu gutter={6} modal={false} placement="top-start">
            <Menu.Trigger
              as={Button}
              variant="ghost-muted"
              size="normal"
              class="max-w-[220px] justify-start gap-1.5 font-medium"
              classList={tone()}
              aria-label={language.t("composer.reasoning.title")}
            >
              {content()}
              <span class="-ms-0.5 -me-1 flex shrink-0">
                <Icon name="chevron-down" />
              </span>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.RadioGroup
                  value={props.reasoning.override()}
                  onChange={(value) => {
                    const choice = reasoningChoices.find((item) => item === value)

                    if (choice) props.reasoning.set(choice)
                  }}
                >
                  <For each={reasoningChoices}>
                    {(choice) => (
                      <Menu.RadioItem value={choice} closeOnSelect>
                        {language.t(reasoningChoiceKeys[choice])}
                      </Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
                <Menu.Separator />
                <Menu.Item onSelect={props.onStatus}>{language.t("command.reasoning.status")}</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </Show>
      </Tooltip>
    </Show>
  )
}

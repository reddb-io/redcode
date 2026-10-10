import { useDialog } from "@opencode/ui/context/dialog"
import { createComponent, onCleanup } from "solid-js"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettingsSurface } from "@/settings/surface"
import { useCommand } from "@/shell/commands/command"
import type { ComposerReasoning } from "./state"

/**
 * The composer's reasoning views, and their palette and slash commands (the TUI's `/reasoning` and `/intelligence`):
 * the mode picker, the S1 / S2 status, and the reasoning roles in Settings.
 */
export function createComposerReasoningActions(state: ComposerReasoning, selection: () => ModelSelection) {
  const dialog = useDialog()
  const settings = useSettingsSurface()
  const command = useCommand()
  const language = useLanguage()
  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())

  // The Models page starts with the reasoning roles.
  const setup = () => settings.open("models")

  const actions = {
    state,
    /** Opens the reasoning roles in Settings. */
    setup,
    /** Opens the session's S1 / S2 roles and evaluations. */
    async status() {
      const { DialogIntelligence } = await import("./dialog")
      if (lifetime.signal.aborted) return

      dialog.show(() =>
        createComponent(DialogIntelligence, {
          sessionID: state.session(),
          model: selection(),
          onSetup: () => {
            dialog.close()
            setup()
          },
        }),
      )
    },
    /** Opens the session's reasoning mode picker. */
    async mode() {
      const { DialogReasoningMode } = await import("./dialog")
      if (lifetime.signal.aborted) return

      dialog.show(() => createComponent(DialogReasoningMode, { reasoning: state }))
    },
  }

  command.register("composer-reasoning", () => [
    {
      id: "reasoning.mode",
      title: language.t("command.reasoning.mode"),
      description: language.t("command.reasoning.mode.description"),
      category: language.t("command.category.session"),
      slash: "reasoning",
      disabled: state.unsupported(),
      onSelect: () => void actions.mode(),
    },
    {
      id: "reasoning.status",
      title: language.t("command.reasoning.status"),
      description: language.t("command.reasoning.status.description"),
      category: language.t("command.category.session"),
      slash: "intelligence",
      disabled: state.unsupported(),
      onSelect: () => void actions.status(),
    },
  ])

  return actions
}

export type ComposerReasoningActions = ReturnType<typeof createComposerReasoningActions>

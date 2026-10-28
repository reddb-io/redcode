import { useDialog } from "@opencode/ui/context/dialog"
import { useSettingsCommand } from "@/settings/command"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"

export function useNewSessionCommands(input: {
  restoreFocus: () => void
  startGoal: (objective: string) => Promise<void>
  project: {
    empty: () => boolean
    open: () => void
  }
  workspace: {
    enabled: () => boolean
    cycle: () => void
  }
}) {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()

  useSettingsCommand()
  command.register("new-session", () => [
    {
      id: "session.goal",
      title: language.t("goal.title"),
      description: language.t("goal.command.description"),
      category: language.t("command.category.session"),
      slash: "goal",
      slashArguments: true,
      onSelect: async (_source, text) => {
        const { GoalDialog } = await import("@/composer/goal-dialog")
        void dialog.show(() => <GoalDialog api={serverSDK.api} input={text ?? ""} startDraft={input.startGoal} />)
      },
    },
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const { DialogCommandPalette } = await import("@/shell/commands/dialog")
        void dialog.show(() => <DialogCommandPalette />)
      },
    },
    {
      id: "input.focus",
      title: language.t("command.input.focus"),
      category: language.t("command.category.view"),
      keybind: "ctrl+l",
      onSelect: input.restoreFocus,
    },
    {
      id: "project.select",
      title: language.t("session.new.project.search"),
      category: language.t("command.category.project"),
      keybind: "mod+shift+o",
      disabled: input.project.empty(),
      onSelect: input.project.open,
    },
    {
      id: "session.location.cycle",
      title: language.t("command.session.location.cycle"),
      category: language.t("command.category.workspace"),
      keybind: "mod+alt+l",
      disabled: !input.workspace.enabled(),
      onSelect: input.workspace.cycle,
    },
  ])
}

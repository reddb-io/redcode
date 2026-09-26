import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { useSettingsCommand } from "@/components/settings-dialog"
import { useCommand } from "@/context/command"

export function useNewSessionCommands(input: {
  restoreFocus: () => void
  project: {
    empty: () => boolean
    open: () => void
  }
}) {
  const command = useCommand()
  const dialog = useDialog()

  useSettingsCommand()
  command.register("new-session", () => [
    {
      id: "command.palette",
      title: "Command palette",
      hidden: true,
      onSelect: async () => {
        const { DialogSelectFile } = await import("@/components/dialog-select-file")
        void dialog.show(() => <DialogSelectFile />)
      },
    },
    {
      id: "input.focus",
      title: "Focus input",
      category: "View",
      keybind: "ctrl+l",
      onSelect: input.restoreFocus,
    },
    {
      id: "project.select",
      title: "Search projects",
      category: "Project",
      keybind: "mod+shift+o",
      disabled: input.project.empty(),
      onSelect: input.project.open,
    },
  ])
}

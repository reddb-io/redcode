import { ActionButton } from "./action-button"
import { DialogMessage } from "./dialog-message"
import { Keymap } from "../context/keymap"
import { useDialog } from "./dialog"

export function DialogHelp() {
  const dialog = useDialog()
  const shortcuts = Keymap.useShortcuts()

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Close help", group: "Dialog", run: () => dialog.clear() },
      { bind: "escape", title: "Close help", group: "Dialog", run: () => dialog.clear() },
    ],
  }))

  return (
    <DialogMessage
      title="Help"
      message={`Press ${shortcuts.get("command.palette.show") ?? ""} to see all available actions and commands in any context.`}
      dismissLabel="esc/enter"
      onDismiss={() => dialog.clear()}
    >
      <ActionButton focused label="ok" onPress={() => dialog.clear()} />
    </DialogMessage>
  )
}

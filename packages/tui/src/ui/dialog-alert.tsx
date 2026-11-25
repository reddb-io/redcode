import { ActionButton } from "./action-button"
import { DialogMessage } from "./dialog-message"
import { Keymap } from "../context/keymap"
import { useDialog } from "./dialog"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert(props: DialogAlertProps) {
  const dialog = useDialog()

  const confirm = () => {
    props.onConfirm?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Confirm alert",
        group: "Dialog",
        run: confirm,
      },
    ],
  }))
  return (
    <DialogMessage title={props.title} message={props.message} onDismiss={() => dialog.clear()}>
      <ActionButton focused label="ok" onPress={confirm} />
    </DialogMessage>
  )
}

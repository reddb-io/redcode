import { DialogMessage, DialogAction } from "./dialog-message"
import { Keymap } from "../context/keymap"
import { useDialog, type DialogContext } from "./dialog"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const dialog = useDialog()

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Close export result",
        group: "Dialog",
        run: close,
      },
    ],
  }))

  return (
    <DialogMessage title="Session exported" message={props.path} onDismiss={close}>
      <DialogAction focused label="Close" onPress={close} />
    </DialogMessage>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })

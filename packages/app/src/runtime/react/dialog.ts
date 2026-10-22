import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"

/** Keep the existing dialog stack and service owner while the native DS owns the modal. */
export function useNativeDialog() {
  const dialog = useDialog()
  const layer = useDialogLayer()
  layer?.setNative(true)
  return {
    open: () => !layer?.closing(),
    close: () => (layer ? layer.close() : dialog.close()),
  }
}

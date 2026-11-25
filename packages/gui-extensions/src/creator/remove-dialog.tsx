import { useNativeDialog } from "@opencode/ui/context/dialog"
import { ReactView } from "@opencode/ui/react-view"
import { AlertDialog } from "@reddb-io/design-system/base/AlertDialog"
import { useExtension } from "../sdk"

export function RemoveDialog(props: {
  title: string
  description: string
  confirmLabel: string
  confirm: () => void
  close: () => void
}) {
  const ctx = useExtension()
  const modal = useNativeDialog()
  return (
    <ReactView
      component={AlertDialog}
      props={{
        open: modal.open(),
        className: "max-h-[90dvh] w-[min(calc(100vw-24px),28rem)] overflow-y-auto",
        title: props.title,
        description: props.description,
        confirmLabel: props.confirmLabel,
        cancelLabel: ctx.t("common.cancel"),
        onConfirm: props.confirm,
        onOpenChange: (open) => {
          if (!open) props.close()
        },
      }}
    />
  )
}

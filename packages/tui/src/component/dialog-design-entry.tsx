import { useClipboard } from "../context/clipboard"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogDesignEntry() {
  const clipboard = useClipboard()
  const dialog = useDialog()
  const toast = useToast()
  return (
    <DialogSelect
      title="Design workspace"
      options={[
        {
          title: "Copy: redcode design",
          value: "redcode design",
          description: "Start Design in another terminal",
          details: [
            "Design has its own resumable session with Plan and Build handoff.",
            "Run this command in your project directory. Your current conversation stays here.",
            "To resume, use redcode design --session with the ID shown in that workspace.",
          ],
        },
      ]}
      onSelect={(option) => {
        if (!clipboard.write) {
          toast.show({ variant: "info", message: option.value, duration: 5000 })
          return
        }
        void clipboard
          .write(option.value)
          .then(() => {
            toast.show({ variant: "success", message: "Copied redcode design", duration: 3000 })
            dialog.clear()
          })
          .catch((error) => toast.show({ variant: "error", message: errorMessage(error) }))
      }}
    />
  )
}

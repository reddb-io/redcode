import { createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"

export function DialogGoalBudget(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  return (
    <DialogPrompt
      title="Total provider attempt budget"
      placeholder="Positive whole number, including attempts already used"
      busy={busy()}
      onCancel={() => dialog.clear()}
      onConfirm={async (text) => {
        const max = Number(text.trim())
        if (!text.trim() || !Number.isSafeInteger(max) || max < 1) {
          toast.show({ variant: "warning", message: "Enter a positive whole number.", duration: 3000 })
          return
        }
        setBusy(true)
        const result = await sdk.client.session
          .goalBudget({ sessionID: props.sessionID, max_turns: max })
          .catch(() => undefined)
        setBusy(false)
        const goal = result?.data
        toast.show({
          variant: goal ? "success" : "warning",
          message: goal
            ? `Goal budget: ${goal.turns.used}/${goal.turns.max} attempts used. ${Number(goal.turns.used) >= Number(goal.turns.max) ? "Increase the total above attempts used to continue." : goal.status === "active" ? "Goal is active." : "Use /goal-resume to continue."}`
            : "Could not update the goal budget.",
          duration: 5000,
        })
        if (goal) dialog.clear()
      }}
    />
  )
}

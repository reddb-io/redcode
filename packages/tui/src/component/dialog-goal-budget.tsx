import { createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import { Budget } from "../util/budget"

export function DialogGoalBudget(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  return (
    <DialogPrompt
      title="Goal budget"
      placeholder="Total turns (30), a spend limit ($3, 500k tokens), both (40 turns $3), or off"
      busy={busy()}
      onCancel={() => dialog.clear()}
      onConfirm={async (text) => {
        const change = Budget.parse(text)
        if (!change.ok) {
          toast.show({ variant: "warning", message: change.error, duration: 4000 })
          return
        }
        setBusy(true)
        const result = await sdk.client.session
          // The route takes null to remove a limit; the generated client drops null from the type.
          .goalBudget({ sessionID: props.sessionID, ...(change.value as { max_cost_usd?: number; max_tokens?: number }) })
          .catch(() => undefined)
        setBusy(false)
        const goal = result?.data
        const limits = Budget.limitsOf(goal?.budget)
        const spend = Budget.hasLimits(limits) ? ` Spend limit: ${Budget.describeLimits(limits)}.` : ""
        toast.show({
          variant: goal ? "success" : "warning",
          message: goal
            ? `Goal budget: ${goal.turns.used}/${goal.turns.max} turns used.${spend} ${Number(goal.turns.used) >= Number(goal.turns.max) ? "Increase the total above turns used to continue." : goal.status === "active" ? "Goal is active." : "Use /goal-resume to continue."}`
            : "Could not update the goal budget.",
          duration: 5000,
        })
        if (goal) dialog.clear()
      }}
    />
  )
}

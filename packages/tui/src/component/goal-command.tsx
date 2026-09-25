import { GoalCommand } from "@reddb-io/redcode-core/session/goal-command"
import type { RedcodeClient, SessionGoal } from "@reddb-io/redcode-sdk/v2"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast, type ToastOptions } from "../ui/toast"
import { Budget } from "../util/budget"
import { DialogGoalBudget } from "./dialog-goal-budget"

export type GoalChoice = {
  readonly title: string
  readonly options: ReadonlyArray<{ title: string; value: GoalCommand.Action; description?: string }>
}

/** What the command needs from the TUI; the dialogs are injected so the flow can be exercised headless. */
export type GoalCommandDeps = {
  readonly client: () => RedcodeClient
  readonly reasoning: () => "single" | "dual"
  readonly agent: () => string | undefined
  readonly notify: (toast: Omit<ToastOptions, "duration"> & { duration?: number }) => void
  /** Offers the actions and resolves the chosen one, or undefined when dismissed. */
  readonly choose: (choice: GoalChoice) => Promise<GoalCommand.Action | undefined>
  /** Asks for the goal text. */
  readonly objective: () => Promise<string | undefined>
  /** Opens the goal budget dialog. */
  readonly budget: (sessionID: string) => void
  readonly show: (title: string, message: string) => void
}

/**
 * Runs `/goal`: the menu, an explicit subcommand, or free text. Free text is the new goal in single
 * reasoning; in dual reasoning the server has System One read it, and a reading that is not sure
 * enough (always the case for dropping or replacing a goal below 0.85) is asked about, never acted on.
 */
export function createGoalCommand(deps: GoalCommandDeps) {
  const run = async (sessionID: string, parsed: GoalCommand.Parsed) => {
    if (parsed.type === "menu") return menu(sessionID)
    if (parsed.type === "action") return act(sessionID, parsed.action, parsed.argument, false)
    if (deps.reasoning() === "single") return act(sessionID, "set", parsed.text, false)
    const resolution = (
      await deps
        .client()
        .session.goalCommand({ sessionID, text: parsed.text })
        .catch(() => undefined)
    )?.data
    if (resolution?.action) return act(sessionID, resolution.action, parsed.text, true)
    const confidence =
      resolution?.confidence === undefined
        ? "System One could not read it"
        : `System One is ${Math.round(resolution.confidence * 100)}% sure`
    const offered: readonly GoalCommand.Action[] = resolution?.options.length ? resolution.options : ["set"]
    const chosen = await deps.choose({
      title: `What should /goal do? ${confidence}`,
      options: offered.map((action) => ({
        title: GoalCommand.LABELS[action],
        value: action,
        description: action === "set" ? parsed.text : undefined,
      })),
    })
    if (chosen) return act(sessionID, chosen, parsed.text, true)
  }

  const menu = async (sessionID: string) => {
    const goal = await read(sessionID)
    const chosen = await deps.choose({
      title: goal ? `${summary(goal)} · ${goal.objective}` : "No goal yet",
      options: GoalCommand.menu(goal?.status).map((action) => ({ title: GoalCommand.LABELS[action], value: action })),
    })
    if (chosen) return act(sessionID, chosen, "", false)
  }

  /** `classified` text is prose: a budget it cannot parse opens the dialog instead of an error. */
  const act = async (sessionID: string, action: GoalCommand.Action, argument: string, classified: boolean) => {
    const client = deps.client()
    if (action === "set") {
      const text = argument.trim() || (await deps.objective())?.trim()
      if (!text) return
      const result = await client.session.goalSet({ sessionID, text, agent: deps.agent() }).catch(() => undefined)
      const goal = result?.data
      const limits = Budget.limitsOf(goal?.budget)
      const refusal = (result?.error as { message?: string } | undefined)?.message
      return deps.notify({
        variant: goal && !goal.warnings?.length ? "success" : "warning",
        message: goal
          ? `Goal set · ${goal.turns.max} turns${Budget.hasLimits(limits) ? ` · budget ${Budget.describeLimits(limits)}` : ""}. Ctrl+C pauses it; /goal resume continues.${goal.warnings?.length ? ` ${goal.warnings.join(" ")}` : ""}`
          : `Could not set the goal${refusal ? `: ${refusal}` : "."}`,
        duration: goal?.warnings?.length ? 8000 : 4000,
      })
    }
    if (action === "pause") {
      const result = await client.session.goalPause({ sessionID }).catch(() => undefined)
      return deps.notify({ variant: "info", message: result?.data ? "Goal paused" : "No goal to pause", duration: 3000 })
    }
    if (action === "resume") {
      const goal = (await client.session.goalResume({ sessionID }).catch(() => undefined))?.data
      return deps.notify({
        variant: goal?.status === "active" ? "success" : "warning",
        message: goal
          ? goal.status === "active"
            ? `Goal resumed · turn ${Number(goal.turns.used) + 1} of ${goal.turns.max}`
            : `Goal ${goal.status}: ${goal.reason ?? "could not resume"}. ${Number(goal.turns.used) >= Number(goal.turns.max) ? "Use /goal budget to increase the total, then /goal resume." : ""}`
          : "No goal to resume",
        duration: 3000,
      })
    }
    if (action === "drop") {
      const result = await client.session.goalDrop({ sessionID }).catch(() => undefined)
      return deps.notify({ variant: "info", message: result?.data ? "Goal dropped" : "No goal to drop", duration: 3000 })
    }
    if (action === "status") {
      const goal = await read(sessionID)
      if (!goal) return deps.notify({ variant: "info", message: "No goal yet. /goal <objective> sets one.", duration: 3000 })
      return deps.show("Goal", [goal.objective, summary(goal), goal.reason].filter(Boolean).join("\n\n"))
    }
    if (!argument.trim()) return deps.budget(sessionID)
    const change = Budget.parse(argument)
    if (!change.ok && classified) return deps.budget(sessionID)
    if (!change.ok)
      return deps.notify({
        variant: "warning",
        message: `${change.error}. To start a goal that begins with "budget", use /goal set …`,
        duration: 5000,
      })
    const goal = (await client.session.goalBudget({ sessionID, ...change.value }).catch(() => undefined))?.data
    const limits = Budget.limitsOf(goal?.budget)
    return deps.notify({
      variant: goal ? "success" : "warning",
      message: goal
        ? `Goal budget: ${goal.turns.used}/${goal.turns.max} turns used.${Budget.hasLimits(limits) ? ` Spend limit: ${Budget.describeLimits(limits)}.` : ""}`
        : "No goal to budget",
      duration: 5000,
    })
  }

  const read = async (sessionID: string) =>
    (await deps.client().session.goal({ sessionID }).catch(() => undefined))?.data ?? undefined

  return { run }
}

/** One line: status, turns and the spend limit. */
function summary(goal: SessionGoal) {
  const limits = Budget.limitsOf(goal.budget)
  const turns =
    goal.status === "active" || goal.status === "paused" || goal.status === "blocked"
      ? ` · turn ${Math.min(Number(goal.turns.used) + 1, Number(goal.turns.max))}/${goal.turns.max}`
      : ""
  return `Goal ${goal.status}${turns}${Budget.hasLimits(limits) ? ` · budget ${Budget.describeLimits(limits)}` : ""}`
}

export function useGoalCommand() {
  const sdk = useSDK()
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()
  return createGoalCommand({
    client: () => sdk.client,
    reasoning: () => local.intelligence.reasoning(),
    agent: () => local.agent.current()?.name,
    notify: (options) => toast.show(options),
    choose: (choice) =>
      new Promise((resolve) => {
        dialog.replace(
          () => (
            <DialogSelect
              title={choice.title}
              options={[...choice.options]}
              onSelect={(option) => {
                resolve(option.value)
                dialog.clear()
              }}
            />
          ),
          () => resolve(undefined),
        )
      }),
    objective: async () => {
      // Free text, plus optional lines — verify:, constraints:, boundaries:, stop when:, gate:, and
      // the opt-in spend limits max cost: and max tokens: (no limit unless typed).
      const text = await DialogPrompt.show(dialog, "What does done look like?", {
        placeholder: "make the tests pass; verify: bun test; gate: bun test; constraints: …; stop when: …",
      })
      dialog.clear()
      return text ?? undefined
    },
    budget: (sessionID) => dialog.replace(() => <DialogGoalBudget sessionID={sessionID} />),
    show: (title, message) => void DialogAlert.show(dialog, title, message),
  })
}

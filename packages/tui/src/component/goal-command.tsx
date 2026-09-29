import { TextAttributes } from "@opentui/core"
import { IntelligenceGoalCommand } from "@opencode/core/intelligence/goal-command"
import type { SessionGoal } from "@opencode/schema/session-goal"
import { For } from "solid-js"
import { useClient } from "../context/client"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { Budget } from "../util/budget"

const BUDGET_PLACEHOLDER = "$5, 5$, 200k tokens, 40 turns, or off"

type Choice = {
  readonly title: string
  readonly details: readonly string[]
  readonly actions: readonly IntelligenceGoalCommand.Action[]
  readonly status: IntelligenceGoalCommand.Status | undefined
}

/**
 * Runs `/goal`: the goal's status with the actions that apply, an explicit subcommand, or free text.
 * The server reads free text (System One in dual reasoning); when the reading is not sure enough,
 * or no reading is available while a goal is unfinished, the user picks the action here. A goal is
 * never dropped or replaced on an unsure reading.
 */
export function useGoalCommand() {
  const client = useClient()
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")

  const run = async (sessionID: string, input: string): Promise<void> => {
    const parsed = IntelligenceGoalCommand.parse(input)
    if (parsed.type === "menu") return status(sessionID)
    if (parsed.type === "action") return act(sessionID, parsed.action, parsed.argument, false)
    const [goal, reading] = await Promise.all([
      client.api.session.goal.get({ sessionID }).catch(() => null),
      client.api.session.goal.command({ sessionID, text: parsed.text }).catch(() => undefined),
    ])
    // Without the server's reading, apply the rule it uses when System One gives none.
    const resolved = reading ?? IntelligenceGoalCommand.decide(undefined, goal?.status)
    if (resolved.action) return act(sessionID, resolved.action, parsed.text, true)
    const chosen = await choose({
      title:
        resolved.confidence === undefined
          ? "A goal is unfinished. What should /goal do?"
          : `What should /goal do? System One is ${Math.round(resolved.confidence * 100)}% sure`,
      details: [`"${parsed.text}"`, ...(goal ? [`Current goal (${goal.status}): ${goal.objective}`] : [])],
      actions: resolved.options,
      status: goal?.status,
    })
    if (chosen) return act(sessionID, chosen, parsed.text, true)
  }

  /** `classified` text is prose read as an action: a budget it cannot parse asks for the amount instead. */
  const act = async (
    sessionID: string,
    action: IntelligenceGoalCommand.Action,
    argument: string,
    classified: boolean,
  ): Promise<void> => {
    if (action === "status") return status(sessionID)
    if (action === "set") return start(sessionID, argument)
    if (action === "budget") return budget(sessionID, argument, classified)
    return client.api.session.goal.control({ sessionID, action }).then(
      (goal) =>
        toast.show({
          variant: goal || action === "drop" ? "info" : "warning",
          message: controlled(action, goal),
          duration: 4000,
        }),
      (error: unknown) => toast.error(error),
    )
  }

  const status = (sessionID: string) =>
    client.api.session.goal.get({ sessionID }).then(
      async (goal) => {
        const chosen = await choose({
          title: goal ? summary(goal) : "No goal yet",
          details: goal ? [goal.objective, goal.reason] : ["/goal <objective> sets one."],
          actions: IntelligenceGoalCommand.menu(goal?.status),
          status: goal?.status,
        })
        if (chosen) return act(sessionID, chosen, "", false)
      },
      (error: unknown) => toast.error(error),
    )

  const start = async (sessionID: string, argument: string) => {
    // Optional lines after the objective: verify:, constraints:, boundaries:, stop when:, gate:.
    const objective =
      argument.trim() ||
      (await ask("What does done look like?", "make the tests pass; verify: bun test; gate: bun test"))?.trim()
    if (!objective) return
    const current = await client.api.session.goal.get({ sessionID }).catch(() => null)
    // The server refuses to replace a running goal; replacing was already decided, so pause it first.
    if (current?.status === "active" || current?.status === "waiting") {
      const paused = await client.api.session.goal.control({ sessionID, action: "pause" }).then(
        () => true,
        (error: unknown) => {
          toast.error(error)
          return false
        },
      )
      if (!paused) return
    }
    return client.api.session.goal.start({ sessionID, objective, agent: local.agent.current()?.id }).then(
      (goal) =>
        toast.show({
          variant: "success",
          message: `Goal set · ${goal.turns.max} steps${spend(goal)}. /goal pause holds it.`,
          duration: 4000,
        }),
      (error: unknown) => toast.error(error),
    )
  }

  const budget = async (sessionID: string, argument: string, classified: boolean): Promise<void> => {
    const typed = argument.trim()
    const text = typed || (await ask("Goal budget", BUDGET_PLACEHOLDER))?.trim()
    if (!text) return
    const change = IntelligenceGoalCommand.budget(text)
    if (!change.ok && classified) return budget(sessionID, "", false)
    if (!change.ok)
      return toast.show({
        variant: "warning",
        message: typed ? `${change.error}. To start a goal that begins with "budget", use /goal set …` : change.error,
        duration: 5000,
      })
    return client.api.session.goal.control({ sessionID, action: "budget", ...change.value }).then(
      (goal) =>
        toast.show({
          variant: goal ? "success" : "warning",
          message: goal ? `Goal budget: ${goal.turns.used}/${goal.turns.max} steps${spend(goal)}` : "No goal to budget",
          duration: 5000,
        }),
      (error: unknown) => toast.error(error),
    )
  }

  const ask = (title: string, placeholder: string) =>
    new Promise<string | undefined>((resolve) => {
      dialog.replace(
        () => (
          <DialogPrompt
            title={title}
            placeholder={placeholder}
            onConfirm={(value) => {
              resolve(value)
              dialog.clear()
            }}
            onCancel={() => dialog.clear()}
          />
        ),
        () => resolve(undefined),
      )
    })

  const choose = (choice: Choice) =>
    new Promise<IntelligenceGoalCommand.Action | undefined>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title={choice.title}
            titleView={
              <box flexDirection="column" flexShrink={1}>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  {choice.title}
                </text>
                <For each={choice.details}>{(line) => <text fg={theme.text.muted}>{line}</text>}</For>
              </box>
            }
            renderFilter={false}
            options={choice.actions.map((action) => ({ title: label(action, choice.status), value: action }))}
            onSelect={(option) => {
              resolve(option.value)
              dialog.clear()
            }}
          />
        ),
        () => resolve(undefined),
      )
    })

  return { run }
}

function label(action: IntelligenceGoalCommand.Action, status: IntelligenceGoalCommand.Status | undefined) {
  if (action === "set" && IntelligenceGoalCommand.unfinished(status)) return "Replace the goal"
  return IntelligenceGoalCommand.LABELS[action]
}

/** The goal fields shown here; the generated client's goal type carries them without the schema brands. */
type GoalView = Pick<SessionGoal.Info, "objective" | "status" | "reason" | "turns" | "budget">

function controlled(action: "pause" | "resume" | "drop", goal: GoalView | null) {
  if (action === "drop") return "Goal dropped"
  if (!goal) return `No goal to ${action}`
  if (action === "pause") return "Goal paused. /goal resume continues it."
  if (goal.status === "active") return `Goal resumed · step ${goal.turns.used + 1} of ${goal.turns.max}`
  return `Goal ${goal.status}: ${goal.reason}`
}

function summary(goal: GoalView) {
  return `Goal ${goal.status} · ${goal.turns.used}/${goal.turns.max} steps${spend(goal)}`
}

function spend(goal: GoalView) {
  return goal.budget && Budget.hasLimits(goal.budget) ? ` · budget ${Budget.describe(goal.budget)}` : ""
}

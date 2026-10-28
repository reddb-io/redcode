import { For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionBudget } from "@opencode/schema/session-budget"
import type { SessionGoal } from "@opencode/schema/session-goal"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { formatServerError } from "@/runtime/server/errors"
import type { ServerApi } from "@/runtime/server/api"

type Goal = Awaited<ReturnType<ServerApi["session"]["goal"]["get"]>>
type Action = SessionGoal.CommandAction

export function GoalDialog(props: {
  api: ServerApi
  sessionID?: string
  input: string
  agent?: string
  startDraft?: (objective: string) => Promise<void>
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({
    goal: null as Goal,
    loading: true,
    loaded: false,
    retry: false,
    error: "",
    objective: "",
    budget: "",
    editing: false,
    budgeting: false,
    choices: [] as Action[],
    request: "",
  })
  const unfinished = () => state.goal && state.goal.status !== "done"
  const fail = (error: unknown) => setState({ loading: false, error: formatServerError(error, language.t) })
  const refresh = async () => {
    if (!props.sessionID) return
    setState("goal", await props.api.session.goal.get({ sessionID: props.sessionID }))
  }
  const start = async (objective: string) => {
    if (!objective.trim()) {
      setState({ editing: true, objective: "", loading: false })
      return
    }
    if (!props.sessionID) {
      await props.startDraft?.(objective.trim())
      dialog.close()
      return
    }
    if (state.goal?.status === "active" || state.goal?.status === "waiting")
      await props.api.session.goal.control({ sessionID: props.sessionID, action: "pause" })
    const goal = await props.api.session.goal.start({
      sessionID: props.sessionID,
      objective: objective.trim(),
      agent: props.agent,
    })
    setState({ goal, objective: "", editing: false, choices: [] })
  }
  const act = async (action: Action, argument = "") => {
    setState({ loading: true, error: "", choices: [] })
    try {
      if (action === "set") await start(argument)
      if (action === "budget") {
        if (!argument.trim()) setState("budgeting", true)
        if (argument.trim() && props.sessionID) {
          const parsed = SessionBudget.parse(argument)
          if (!parsed.ok) throw new Error(parsed.error)
          if (parsed.value.maxTurns && parsed.value.maxTurns > 1000) throw new Error(language.t("goal.budget.maxSteps"))
          setState(
            "goal",
            await props.api.session.goal.control({ sessionID: props.sessionID, action: "budget", ...parsed.value }),
          )
          setState({ budgeting: false, budget: "" })
        }
      }
      if (action === "pause" || action === "resume" || action === "drop") {
        if (props.sessionID)
          setState("goal", await props.api.session.goal.control({ sessionID: props.sessionID, action }))
      }
      setState("loading", false)
    } catch (error) {
      if (action === "set") setState({ editing: true, objective: argument })
      if (action === "budget") setState({ budgeting: true, budget: argument })
      fail(error)
    }
  }
  const load = async () => {
    setState({ loading: true, error: "", retry: false })
    try {
      await refresh()
      setState("loaded", true)
      const text = props.input.trim()
      if (!text) {
        setState("loading", false)
        return
      }
      const match = /^(set|budget)(?:\s+([\s\S]*))?$/i.exec(text)
      if (!props.sessionID) {
        if (/^(pause|resume|drop|status|budget)$/i.test(text) || match?.[1]?.toLowerCase() === "budget") {
          setState("loading", false)
          return
        }
        await act("set", match?.[1]?.toLowerCase() === "set" ? (match[2] ?? "") : text)
        return
      }
      const reading = await props.api.session.goal.command({ sessionID: props.sessionID, text })
      if (!reading.action) {
        setState({ loading: false, choices: [...reading.options], request: text })
        return
      }
      if (reading.action === "status") {
        setState("loading", false)
        return
      }
      const argument = match && match[1]?.toLowerCase() === reading.action ? (match[2] ?? "") : text
      await act(reading.action, argument)
    } catch (error) {
      setState("retry", true)
      fail(error)
    }
  }
  onMount(() => void load())
  const labels: Record<Action, () => string> = {
    set: () => language.t(unfinished() ? "goal.replace" : "goal.set"),
    pause: () => language.t("goal.pause"),
    resume: () => language.t("goal.resume"),
    drop: () => language.t("goal.drop"),
    budget: () => language.t("goal.budget"),
    status: () => language.t("goal.status"),
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("goal.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex flex-col gap-3 px-4 pb-4 !overflow-y-auto">
        <Show when={state.loading}>
          <p role="status">{language.t("common.loading")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="text-body text-feedback-danger-foreground">
            {state.error}
          </p>
        </Show>
        <Show when={state.retry}>
          <Button type="button" variant="outline" size="small" onClick={() => void load()}>
            {language.t("common.retry")}
          </Button>
        </Show>
        <Show when={!state.loading && state.loaded && !state.retry}>
          <Show when={state.goal} fallback={<p class="text-body text-ink-muted">{language.t("goal.empty")}</p>}>
            {(goal) => (
              <div class="flex flex-col gap-1 text-body">
                <p class="font-medium">
                  {language.t("goal.summary", {
                    status: language.t(`goal.status.${goal().status}`),
                    used: goal().turns.used,
                    max: goal().turns.max,
                  })}
                </p>
                <p class="whitespace-pre-wrap break-words">{goal().objective}</p>
                <p class="text-ink-muted">{goal().reason}</p>
                <Show when={goal().budget?.maxCostUsd || goal().budget?.maxTokens}>
                  <p class="text-ink-muted">
                    {language.t("goal.limits", {
                      cost: goal().budget?.maxCostUsd ?? "—",
                      tokens: goal().budget?.maxTokens ?? "—",
                    })}
                  </p>
                </Show>
              </div>
            )}
          </Show>
          <Show when={state.choices.length}>
            <p class="text-body">{language.t("goal.ambiguous", { text: state.request })}</p>
            <div class="flex flex-wrap gap-2">
              <For each={state.choices}>
                {(action) => (
                  <Button type="button" variant="outline" size="small" onClick={() => void act(action, state.request)}>
                    {labels[action]()}
                  </Button>
                )}
              </For>
            </div>
          </Show>
          <Show when={!state.choices.length}>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="small"
                onClick={() => setState({ editing: true, budgeting: false })}
              >
                {labels.set()}
              </Button>
              <Show when={state.goal?.status === "active" || state.goal?.status === "waiting"}>
                <Button type="button" variant="outline" size="small" onClick={() => void act("pause")}>
                  {labels.pause()}
                </Button>
              </Show>
              <Show when={state.goal?.status === "paused" || state.goal?.status === "blocked"}>
                <Button type="button" variant="outline" size="small" onClick={() => void act("resume")}>
                  {labels.resume()}
                </Button>
              </Show>
              <Show when={unfinished()}>
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  onClick={() => setState({ budgeting: true, editing: false })}
                >
                  {labels.budget()}
                </Button>
              </Show>
              <Show when={state.goal}>
                <Button type="button" variant="outline" size="small" onClick={() => void act("drop")}>
                  {labels.drop()}
                </Button>
              </Show>
            </div>
            <Show when={state.editing}>
              <form
                class="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void act("set", state.objective)
                }}
              >
                <label class="flex flex-col gap-1 text-body">
                  {language.t("goal.objective")}
                  <textarea
                    class="min-h-24 w-full rounded-md border border-stroke-base bg-surface-base p-2 text-body"
                    value={state.objective}
                    onInput={(event) => setState("objective", event.currentTarget.value)}
                  />
                </label>
                <Button type="submit" disabled={!state.objective.trim()}>
                  {language.t(unfinished() ? "goal.replace" : "goal.start")}
                </Button>
              </form>
            </Show>
            <Show when={state.budgeting}>
              <form
                class="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void act("budget", state.budget)
                }}
              >
                <label class="flex flex-col gap-1 text-body">
                  {language.t("goal.budget.label")}
                  <input
                    class="h-8 w-full rounded-md border border-stroke-base bg-surface-base px-2 text-body"
                    value={state.budget}
                    placeholder={language.t("goal.budget.placeholder")}
                    onInput={(event) => setState("budget", event.currentTarget.value)}
                  />
                </label>
                <Button type="submit" disabled={!state.budget.trim()}>
                  {language.t("goal.budget.save")}
                </Button>
              </form>
            </Show>
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

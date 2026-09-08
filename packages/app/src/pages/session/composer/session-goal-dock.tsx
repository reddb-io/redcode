import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { createMemo, createEffect, onCleanup, Show, For } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { SessionsGoalOutput, SessionsPlansOutput } from "@reddb-io/redcode-client"
import { useSDK } from "@/context/sdk"
import { useGoalApi } from "@/utils/goal-api"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

/** Legacy Goal metadata; SessionV2 uses the durable Goal endpoint below. */
export function goalLine(metadata: Record<string, unknown> | undefined) {
  const goal = metadata?.["goal"]
  if (!goal || typeof goal !== "object") return undefined
  const g = goal as Record<string, unknown>
  const status = String(g["status"] ?? "")
  if (!status || status === "dropped") return undefined
  const turns = g["turns"] as { used?: number; max?: number } | undefined
  const used = typeof turns?.used === "number" ? turns.used : 0
  const max = typeof turns?.max === "number" ? turns.max : 0
  const objective = typeof g["objective"] === "string" ? g["objective"] : ""
  const reason = typeof g["reason"] === "string" ? g["reason"] : ""
  if (status === "active")
    return { tone: "active" as const, label: `turn ${Math.min(used + 1, max)}/${max}`, objective }
  if (status === "done") return { tone: "done" as const, label: "done", objective }
  return { tone: "paused" as const, label: reason ? `${status} — ${reason}` : status, objective }
}

export function SessionGoalDock(props: { metadata: Record<string, unknown> | undefined; sessionID?: string }) {
  const api = useGoalApi()
  const sdk = useSDK()
  const language = useLanguage()
  const [state, setState] = createStore<{ goal: SessionsGoalOutput; plans: SessionsPlansOutput; busy: boolean }>({
    goal: null,
    plans: [],
    busy: false,
  })
  createEffect(() => {
    const sessionID = props.sessionID
    setState({ goal: null, plans: [], busy: false })
    if (!sessionID) return
    let disposed = false
    let pending = false
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (disposed) return
      if (pending) {
        dirty = true
        return
      }
      dirty = false
      pending = true
      try {
        if (!(await api.current()) || disposed) return
        const [goal, plans] = await Promise.all([api.get(sessionID), api.plans(sessionID)])
        if (!disposed) {
          setState("goal", goal)
          setState("plans", reconcile(plans, { key: "revision" }))
        }
      } catch {
        // Older servers have no current Goal endpoint; retain their metadata view.
      } finally {
        pending = false
        if (!disposed && (dirty || (state.goal && ["active", "waiting"].includes(state.goal.status))))
          timer = setTimeout(refresh, dirty ? 0 : 2000)
      }
    }
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === sessionID) {
        clearTimeout(timer)
        void refresh()
      }
    }
    const unsubscribe = sdk().event.on("session.status", (event) => {
      if (event.properties.sessionID !== sessionID) return
      clearTimeout(timer)
      void refresh()
    })
    window.addEventListener("redcode:goal", changed)
    void refresh()
    onCleanup(() => {
      unsubscribe()
      disposed = true
      clearTimeout(timer)
      window.removeEventListener("redcode:goal", changed)
    })
  })
  const control = async (action: "pause" | "resume" | "budget") => {
    const sessionID = props.sessionID
    if (!sessionID || state.busy) return
    setState("busy", true)
    try {
      const goal = await api.control({
        sessionID,
        action,
        ...(action === "budget" ? { maxTurns: Math.min(1000, (state.goal?.turns.max ?? 0) + 20) } : {}),
      })
      if (props.sessionID === sessionID) setState("goal", goal)
    } catch {
      showToast({ title: language.t("session.goal.error") })
    } finally {
      if (props.sessionID === sessionID) setState("busy", false)
    }
  }
  const line = createMemo(() => goalLine(props.metadata))
  return (
    <>
      <Show when={state.goal}>
        {(goal) => (
          <div
            data-component="session-goal-progress"
            class="px-3 py-2 text-12-regular border-b border-border-weak-base"
          >
            <div class="flex items-center gap-2">
              <strong>{language.t(`session.goal.state.${goal().status}`)}</strong>
              <span class="truncate">{goal().objective}</span>
            </div>
            <div class="text-text-weak">
              {language.t("session.goal.providerBudget", goal().turns)} ·{" "}
              {language.plural("session.goal.tokenCount", goal().tokens)} ·{" "}
              {language.plural("session.goal.evidenceCount", goal().evidence.length)}
            </div>
            <div class="text-text-weak break-words">{goal().reason}</div>
            <Show when={goal().evidence.length > 0}>
              <details>
                <summary class="cursor-pointer select-none py-1">{language.t("session.goal.evidence")}</summary>
                <For each={goal().evidence}>
                  {(item) => (
                    <div class="break-all text-text-weak py-1">
                      {item.path} · {item.hash}
                    </div>
                  )}
                </For>
              </details>
            </Show>
            <Show when={goal().checks.length > 0}>
              <details>
                <summary class="cursor-pointer select-none py-1">{language.t("session.goal.checks")}</summary>
                <For each={goal().checks}>
                  {(item) => (
                    <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-raised-base p-2">
                      {item.command} · {item.exitCode}
                      {"\n"}
                      {item.output}
                    </pre>
                  )}
                </For>
              </details>
            </Show>
            <Show when={goal().status !== "done"}>
              <div class="flex gap-2 pt-2">
                <ButtonV2
                  size="small"
                  variant="neutral"
                  disabled={state.busy}
                  onClick={() => void control(goal().status === "active" ? "pause" : "resume")}
                >
                  {language.t(
                    goal().status === "active" ? "command.session.goal.pause" : "command.session.goal.resume",
                  )}
                </ButtonV2>
                <ButtonV2
                  size="small"
                  variant="neutral"
                  disabled={state.busy || goal().turns.max >= 1000}
                  onClick={() => void control("budget")}
                >
                  {language.t("session.goal.extend")}
                </ButtonV2>
              </div>
            </Show>
          </div>
        )}
      </Show>
      <Show when={state.plans.length > 0}>
        <details class="px-3 py-2 text-12-regular" data-component="session-plan-history">
          <summary class="cursor-pointer select-none py-1">{language.t("session.goal.plans")}</summary>
          <For each={state.plans}>
            {(plan) => (
              <details>
                <summary class="cursor-pointer select-none py-1">
                  {language.t(`session.goal.plan.${plan.status}`)} · {plan.revision.slice(0, 12)}
                </summary>
                <pre class="max-h-64 overflow-auto whitespace-pre-wrap">{plan.content}</pre>
              </details>
            )}
          </For>
        </details>
      </Show>
      {!state.goal && line() && (
        <div
          data-component="session-goal-dock"
          data-tone={line()!.tone}
          class="flex items-center gap-2 px-3 py-1.5 text-12-regular text-text-weak border-b border-border-weak-base"
          title={line()!.objective}
        >
          <span
            class="shrink-0 rounded-full px-1.5 py-0.5 text-11-medium"
            classList={{
              "bg-surface-raised-base text-text-strong": line()!.tone === "active",
              "bg-surface-success-base text-text-success": line()!.tone === "done",
              "bg-surface-warning-base text-text-warning": line()!.tone === "paused",
            }}
          >
            goal · {line()!.label}
          </span>
          <span class="truncate">{line()!.objective}</span>
        </div>
      )}
    </>
  )
}

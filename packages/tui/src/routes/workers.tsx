import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useRedskilled } from "../context/redskilled"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"

export function Workers() {
  const redskilled = useRedskilled()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const [selected, setSelected] = createSignal(0)
  const [steer, setSteer] = createSignal<{ status: "none" | "pending" | "consumed"; iteration?: number }>()
  const status = redskilled.status
  const workers = createMemo(() => status()?.payload?.workers ?? [])
  const worker = createMemo(() => workers()[selected()])

  const run = (action: () => Promise<unknown>, message: string) =>
    action()
      .then(() => toast.show({ variant: "success", message }))
      .catch(toast.error)

  const stopWorker = async () => {
    const current = worker()
    if (!current) return
    if (!(await DialogConfirm.show(dialog, "Stop Worker", `Stop ${current.worker_id} now?`))) return
    await run(() => redskilled.stopWorker(current.worker_id), `Stopped ${current.worker_id}`)
  }

  const recycleWorker = async () => {
    const current = worker()
    if (!current) return
    if (!(await DialogConfirm.show(dialog, "Recycle Worker", `Recycle ${current.worker_id} and refill its slot?`)))
      return
    await run(() => redskilled.recycleWorker(current.worker_id), `Recycling ${current.worker_id}`)
  }

  const steerWorker = async () => {
    const current = worker()
    if (!current) return
    const text = await DialogPrompt.show(dialog, `Steer ${current.worker_id}`, {
      placeholder: "What should this Worker do next?",
    })
    if (!text?.trim()) return
    await run(() => redskilled.steerWorker(current.worker_id, text.trim()), `Steer queued for ${current.worker_id}`)
  }

  const resize = async () => {
    const value = await DialogPrompt.show(dialog, "Resize project", {
      value: String(status()?.activation?.target ?? 1),
      placeholder: "Worker target",
    })
    if (value === null) return
    const target = Number.parseInt(value, 10)
    if (!Number.isInteger(target) || target < 0)
      return toast.show({ variant: "error", message: "Target must be zero or greater" })
    await run(() => redskilled.resize(target), `Project target set to ${target}`)
  }

  const stopProject = async () => {
    if (
      !(await DialogConfirm.show(dialog, "Stop project", "Stop every Worker and release this project's registration?"))
    )
      return
    await run(redskilled.stopProject, "Project stopped for this session")
  }

  const disable = async () => {
    if (
      !(await DialogConfirm.show(dialog, "Disable RedSkills", "Stop this project and do not reconnect automatically?"))
    )
      return
    await run(() => redskilled.consent("refused"), "RedSkills disabled for this project")
  }

  onMount(() => redskilled.setActive(true))
  onCleanup(() => redskilled.setActive(false))
  createEffect(() => {
    if (selected() < workers().length) return
    setSelected(Math.max(0, workers().length - 1))
  })
  let steerRequest = 0
  createEffect(() => {
    status()?.payload?.generated_at
    const current = worker()
    if (!current || redskilled.scope() !== "project") {
      steerRequest++
      setSteer()
      return
    }
    const request = ++steerRequest
    void redskilled
      .steerStatus(current.worker_id)
      .then((result) => {
        if (request === steerRequest) setSteer(result)
      })
      .catch(() => {
        if (request === steerRequest) setSteer()
      })
  })

  useBindings(() => ({
    bindings: [
      {
        key: "j",
        desc: "Next Worker",
        group: "Workers",
        cmd: () => setSelected(Math.min(workers().length - 1, selected() + 1)),
      },
      { key: "k", desc: "Previous Worker", group: "Workers", cmd: () => setSelected(Math.max(0, selected() - 1)) },
      { key: "s", desc: "Stop Worker", group: "Workers", cmd: () => void stopWorker() },
      { key: "r", desc: "Recycle Worker", group: "Workers", cmd: () => void recycleWorker() },
      { key: "e", desc: "Steer Worker", group: "Workers", cmd: () => void steerWorker() },
      { key: "z", desc: "Resize project", group: "Workers", cmd: () => void resize() },
      { key: "p", desc: "Stop project", group: "Workers", cmd: () => void stopProject() },
      {
        key: "h",
        desc: "Toggle host scope",
        group: "Workers",
        cmd: () => redskilled.setScope(redskilled.scope() === "project" ? "host" : "project"),
      },
    ],
  }))

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            RedDB Workers
          </text>
          <text fg={tone(status()?.lifecycle, theme)}>
            {mark(status()?.lifecycle)} {status()?.lifecycle ?? "connecting"}
          </text>
          <Show when={status()?.payload?.staleness.stale}>
            <text fg={theme.warning}>stale</text>
          </Show>
        </box>
        <box flexDirection="row" gap={1}>
          <text
            fg={redskilled.scope() === "project" ? theme.primary : theme.textMuted}
            onMouseUp={() => redskilled.setScope("project")}
          >
            Project
          </text>
          <text fg={theme.textMuted}>/</text>
          <text
            fg={redskilled.scope() === "host" ? theme.primary : theme.textMuted}
            onMouseUp={() => redskilled.setScope("host")}
          >
            Host
          </text>
        </box>
      </box>

      <Show when={status()?.activation}>
        {(activation) => (
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>{activation().project}</text>
            <text fg={theme.text}>
              {activation().runner} × {activation().target}
            </text>
            <text fg={theme.textMuted}>
              {status()?.payload?.host.worker_count ?? 0} workers ·{" "}
              {formatBytes(status()?.payload?.host.observed_rss_bytes)}
            </text>
            <Show when={status()?.consent === "accepted"}>
              <Show when={!status()?.payload?.registered_projects?.includes(activation().project)}>
                <text
                  fg={theme.success}
                  onMouseUp={() => void run(() => redskilled.consent("accepted"), "Project registered")}
                >
                  [start]
                </text>
              </Show>
              <text fg={theme.info} onMouseUp={() => void resize()}>
                [z resize]
              </text>
              <text fg={theme.warning} onMouseUp={() => void stopProject()}>
                [p stop project]
              </text>
              <text fg={theme.error} onMouseUp={() => void disable()}>
                [disable]
              </text>
            </Show>
          </box>
        )}
      </Show>

      <Show when={status()?.lifecycle === "unavailable" || status()?.lifecycle === "ineligible"}>
        <box border borderColor={theme.border} padding={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            RedSkills is ready to connect
          </text>
          <text fg={theme.textMuted}>
            Enable plugins.dev.enabled in .red/config.yaml and connect the redskilled MCP server.
          </text>
          <Show when={status()?.error}>
            <text fg={theme.error}>{status()?.error}</text>
          </Show>
        </box>
      </Show>

      <Show when={status()?.lifecycle === "needs_consent"}>
        <box border borderColor={theme.border} padding={1} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>Let red-code register this project with redskilled?</text>
          <text
            fg={theme.primary}
            onMouseUp={() => void run(() => redskilled.consent("accepted"), "RedSkills connected")}
          >
            [Connect]
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => void run(() => redskilled.consent("refused"), "RedSkills disabled for this project")}
          >
            [No thanks]
          </text>
        </box>
      </Show>

      <Show when={status()?.consent === "refused"}>
        <box border borderColor={theme.border} padding={1} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>Automatic registration is disabled for this project.</text>
          <text
            fg={theme.primary}
            onMouseUp={() => void run(() => redskilled.consent("accepted"), "RedSkills enabled")}
          >
            [Enable integration]
          </text>
        </box>
      </Show>

      <Show
        when={workers().length > 0}
        fallback={
          <text fg={theme.textMuted}>{redskilled.loading() ? "Reading daemon…" : "No Workers in this scope"}</text>
        }
      >
        <box flexDirection="row" gap={2} flexGrow={1} minHeight={0}>
          <box width="58%" flexDirection="column" border borderColor={theme.border}>
            <box flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement}>
              <text width={12} fg={theme.textMuted}>
                WORKER
              </text>
              <text width={10} fg={theme.textMuted}>
                ISSUE
              </text>
              <text width={16} fg={theme.textMuted}>
                PHASE
              </text>
              <text flexGrow={1} fg={theme.textMuted}>
                MODEL
              </text>
            </box>
            <For each={workers()}>
              {(item, index) => (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={index() === selected() ? theme.backgroundElement : undefined}
                  onMouseDown={() => setSelected(index())}
                >
                  <text width={12} fg={index() === selected() ? theme.primary : theme.text}>
                    {item.worker_id.slice(0, 10)}
                  </text>
                  <text width={10} fg={theme.text}>
                    {item.display?.issue ?? "—"}
                  </text>
                  <text width={16} fg={item.display?.failed ? theme.error : theme.success}>
                    {item.display?.phase ?? item.display?.step ?? "starting"}
                  </text>
                  <text flexGrow={1} fg={theme.textMuted}>
                    {item.display?.model ?? item.display?.runner ?? "unpublished"}
                  </text>
                </box>
              )}
            </For>
          </box>

          <Show when={worker()}>
            {(current) => (
              <box flexGrow={1} flexDirection="column" border borderColor={theme.border} padding={1} gap={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {current().worker_id}
                </text>
                <text fg={theme.textMuted}>
                  {current().project_label} · pid {current().pid}
                </text>
                <text fg={theme.text}>
                  {current().display?.runner ?? "runner ?"} · {current().display?.model ?? "model ?"} ·{" "}
                  {current().display?.effort ?? "effort ?"}
                </text>
                <text fg={theme.text}>
                  Phase {progress(current().display?.phase_index, current().display?.phase_total)}{" "}
                  {current().display?.phase ?? current().display?.step ?? "starting"}
                </text>
                <text fg={theme.textMuted}>
                  elapsed {formatDuration(current().uptime_ms)} · ETA {formatDuration(seconds(current().display?.eta))}
                </text>
                <text fg={theme.textMuted}>
                  RSS {formatBytes(current().vitals.rss_bytes)} · budget {formatPercent(current().budget.used_fraction)}
                </text>
                <text fg={theme.textMuted}>
                  LOC +{current().display?.added ?? 0}/-{current().display?.removed ?? 0} · tokens{" "}
                  {formatCount(current().display?.tokens)} · tools {formatCount(current().display?.tools)}
                </text>
                <Show when={steer()?.status !== "none" && steer()}>
                  {(state) => (
                    <text fg={state().status === "pending" ? theme.warning : theme.textMuted}>
                      steer {state().status}
                      {state().iteration === undefined ? "" : ` at iteration ${state().iteration}`}
                    </text>
                  )}
                </Show>
                <Show when={current().log.last_line}>
                  <text fg={theme.text} wrapMode="word">
                    {current().log.last_line}
                  </text>
                </Show>
                <Show
                  when={redskilled.scope() === "project"}
                  fallback={<text fg={theme.textMuted}>Other projects are read-only.</text>}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.warning} onMouseUp={() => void stopWorker()}>
                      [s stop]
                    </text>
                    <text fg={theme.info} onMouseUp={() => void recycleWorker()}>
                      [r recycle]
                    </text>
                    <text fg={theme.primary} onMouseUp={() => void steerWorker()}>
                      [e steer]
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </Show>
        </box>
      </Show>
      <text fg={theme.textMuted}>
        j/k select · h project/host · s stop · r recycle · e steer · z resize · p stop project
      </text>
    </box>
  )
}

function mark(value: string | undefined) {
  if (value === "live") return "●"
  if (value === "degraded" || value === "needs_consent") return "◆"
  return "○"
}

function tone(value: string | undefined, theme: ReturnType<typeof useTheme>["theme"]) {
  if (value === "live") return theme.success
  if (value === "degraded" || value === "needs_consent") return theme.warning
  if (value === "unavailable") return theme.error
  return theme.textMuted
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatBytes(value: unknown) {
  const bytes = number(value)
  if (bytes === null) return "?"
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)}K`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}M`
  return `${(bytes / 1024 ** 3).toFixed(1)}G`
}

function formatDuration(value: unknown) {
  const ms = number(value)
  if (ms === null) return "?"
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function seconds(value: unknown) {
  const amount = number(value)
  return amount === null ? null : amount * 1_000
}

function formatPercent(value: unknown) {
  const fraction = number(value)
  return fraction === null ? "?" : `${Math.round(fraction * 100)}%`
}

function formatCount(value: unknown) {
  const amount = number(value)
  return amount === null ? "?" : amount.toLocaleString()
}

function progress(index: unknown, total: unknown) {
  return `${number(index) ?? "?"}/${number(total) ?? "?"}`
}

import type { RedskilledStatusOutput } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { Status } from "@opencode/schema/redskilled"
import { Schema } from "effect"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { errorMessage } from "../../util/error"
import { openUrl } from "@opencode/util/open"

const ROUTE = "workers"

function WorkersPage(props: { context: Plugin.Context; onClose: () => void }) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const location = props.context.location ?? props.context.data.location.default()
  const [status, setStatus] = createSignal<Status>()
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const [selectedID, setSelectedID] = createSignal<string>()
  const workers = createMemo(() => status()?.payload?.workers ?? [])
  const selectedIndex = createMemo(() => Math.max(0, workers().findIndex((item) => item.worker_id === selectedID())))
  const selected = createMemo(() => workers()[selectedIndex()])
  const width = () => Math.max(20, Math.min(110, dimensions().width - 4))

  let polling = false
  let revision = 0
  const load = async () => {
    if (busy() || polling) return
    polling = true
    const observed = revision
    try {
      const result = await props.context.client.redskilled.status({ location, scope: "project" })
      if (revision === observed) setStatus(Schema.decodeUnknownSync(Status)(result.data))
    } catch (cause) {
      if (revision === observed)
        setStatus({ lifecycle: "unavailable", consent: "unknown", scope: "project", native: true, error: errorMessage(cause) })
    } finally {
      polling = false
      setLoading(false)
    }
  }
  const run = async (action: () => Promise<RedskilledStatusOutput>, message: string) => {
    if (busy()) return
    revision++
    setBusy(true)
    try {
      const result = await action()
      setStatus(Schema.decodeUnknownSync(Status)(result.data))
      props.context.ui.toast.show({ variant: "success", message })
    } catch (cause) {
      props.context.ui.toast.show({ variant: "error", message: errorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }
  const move = (offset: number) => {
    if (!workers().length) return
    setSelectedID(workers()[Math.max(0, Math.min(workers().length - 1, selectedIndex() + offset))].worker_id)
  }
  const startDrain = () => run(
    () => props.context.client.redskilled.consent({ location, decision: "accepted" }),
    "Project drain started",
  )
  const resize = async () => {
    const answer = await props.context.ui.dialog.prompt({
      title: "Resize project",
      value: String(status()?.activation?.target ?? 1),
      placeholder: "Worker target",
    })
    if (answer === undefined) return
    const target = Number(answer.trim())
    if (!Number.isInteger(target) || target < 0)
      return props.context.ui.toast.show({ variant: "error", message: "Target must be zero or greater" })
    await run(() => props.context.client.redskilled.project.resize({ location, target }), `Project target set to ${target}`)
  }
  const stopProject = async () => {
    if (!(await props.context.ui.dialog.confirm({ title: "Stop project", message: "Stop this project's drain?" }))) return
    await run(() => props.context.client.redskilled.project.stop({ location }), "Project drain stopped")
  }
  const stopWorker = async () => {
    const worker = selected()
    if (!worker || !(await props.context.ui.dialog.confirm({ title: "Stop worker", message: `Stop ${worker.worker_id}?` }))) return
    await run(() => props.context.client.redskilled.worker.stop({ location, worker: worker.worker_id }), `Stopped ${worker.worker_id}`)
  }
  const recycleWorker = async () => {
    const worker = selected()
    if (!worker || !(await props.context.ui.dialog.confirm({ title: "Recycle worker", message: `Recycle ${worker.worker_id}?` }))) return
    await run(() => props.context.client.redskilled.worker.recycle({ location, worker: worker.worker_id }), `Recycling ${worker.worker_id}`)
  }
  const steerWorker = async () => {
    const worker = selected()
    if (!worker) return
    const answer = await props.context.ui.dialog.prompt({ title: `Steer ${worker.worker_id}`, placeholder: "What should this worker do next?" })
    const text = answer?.trim()
    if (!text) return
    await run(() => props.context.client.redskilled.worker.steer({ location, worker: worker.worker_id, text }), `Steer queued for ${worker.worker_id}`)
  }
  const openIssue = () => {
    const worker = selected()
    const issue = worker?.display?.issue?.replace(/^#/, "")
    if (!worker || !issue || !/^\d+$/.test(issue) || !/^[\w.-]+\/[\w.-]+$/.test(worker.project_label))
      return props.context.ui.toast.show({ variant: "info", message: "This worker has no linked issue" })
    void openUrl(`https://github.com/${worker.project_label}/issues/${issue}`).catch((cause) =>
      props.context.ui.toast.show({ variant: "error", message: errorMessage(cause) }),
    )
  }

  onMount(() => void load())
  const timer = setInterval(() => void load(), 5_000)
  onCleanup(() => clearInterval(timer))
  props.context.keymap.layer(() => ({
    commands: [
      { bind: "escape", title: "Back", group: "Workers", run: props.onClose },
      { bind: "j", title: "Next worker", group: "Workers", run: () => move(1) },
      { bind: "down", title: "Next worker", group: "Workers", run: () => move(1) },
      { bind: "k", title: "Previous worker", group: "Workers", run: () => move(-1) },
      { bind: "up", title: "Previous worker", group: "Workers", run: () => move(-1) },
      { bind: "R", title: "Refresh workers", group: "Workers", run: () => void load() },
      { bind: "d", title: "Start project drain", group: "Workers", run: () => void startDrain() },
      { bind: "z", title: "Resize project", group: "Workers", run: () => void resize() },
      { bind: "p", title: "Stop project", group: "Workers", run: () => void stopProject() },
      { bind: "s", title: "Stop worker", group: "Workers", run: () => void stopWorker() },
      { bind: "r", title: "Recycle worker", group: "Workers", run: () => void recycleWorker() },
      { bind: "e", title: "Steer worker", group: "Workers", run: () => void steerWorker() },
      { bind: "o", title: "Open worker issue", group: "Workers", run: openIssue },
    ],
  }))

  return (
    <box width="100%" height="100%" alignItems="center" backgroundColor={theme.background.base}>
      <box width={width()} flexGrow={1} minHeight={0} paddingTop={1} paddingBottom={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>RedSkills / Workers</text>
          <text fg={theme.text.muted} onMouseUp={props.onClose}>esc back</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={status()?.lifecycle === "unavailable" ? theme.text.feedback.error.base : theme.text.base}>
            {loading() ? "Connecting…" : status()?.lifecycle ?? "unknown"}
            {status()?.activation?.project ? ` · ${status()!.activation!.project}` : ""}
          </text>
          <text fg={theme.text.muted}>
            {busy() ? "Working… · " : ""}{workers().length} workers
            {workers().some((item) => item.display?.failed)
              ? ` · ${workers().filter((item) => item.display?.failed).length} failed`
              : ""}
          </text>
        </box>
        <Show when={status()?.queue}>
          {(queue) => (
            <box>
              <text fg={theme.text.base}>
                Queue: {queue().posture} · {queue().depth ?? "?"} pending · {queue().live} live
                {queue().target === null ? "" : ` / ${queue().target} target`}
              </text>
              <text fg={theme.text.muted} wrapMode="word">
                {queue().registered ? queue().detail : `No project registration · ${queue().detail}`}
              </text>
            </box>
          )}
        </Show>
        <Show when={status()?.error}>
          {(message) => <text fg={theme.text.feedback.error.base} wrapMode="word">{message()}</text>}
        </Show>
        <box flexDirection={width() < 70 ? "column" : "row"} gap={width() < 70 ? 0 : 2}>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void startDrain()}>d start drain</text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void resize()}>z resize</text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void stopProject()}>p stop project</text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void load()}>R refresh</text>
        </box>
        <box flexDirection={width() < 70 ? "column" : "row"} gap={width() < 70 ? 0 : 2}>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void stopWorker()}>s stop</text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void recycleWorker()}>r recycle</text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void steerWorker()}>e steer</text>
          <text fg={theme.text.action.secondary.base} onMouseUp={openIssue}>o issue</text>
        </box>
        <scrollbox flexGrow={1} minHeight={0} width="100%">
          <Show when={workers().length > 0} fallback={
            <text fg={theme.text.muted}>
              {status()?.lifecycle === "unavailable" ? "Worker status is unavailable." : "No live workers. Start the project drain when ready."}
            </text>
          }>
            <For each={workers()}>
              {(worker) => (
                <box
                  width="100%"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={worker.worker_id === selected()?.worker_id ? theme.background.formfield.selected : undefined}
                  onMouseUp={() => setSelectedID(worker.worker_id)}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={worker.worker_id === selected()?.worker_id ? theme.text.formfield.selected : theme.text.base}>
                      {worker.worker_id} {worker.display?.issue ?? ""}
                    </text>
                    <text fg={worker.display?.failed ? theme.text.feedback.error.base : theme.text.muted}>
                      {worker.display?.phase ?? (worker.display?.failed ? "failed" : "running")}
                    </text>
                  </box>
                  <text fg={theme.text.muted}>
                    {worker.display?.step ?? "—"} · {worker.budget.declared ?? "no memory budget"} · pid {worker.pid}
                  </text>
                  <Show when={worker.base_commits_ahead || worker.warnings?.length}>
                    <text fg={worker.warnings?.length ? theme.text.feedback.warning.base : theme.text.muted} wrapMode="word">
                      {worker.base_commits_ahead ? `${worker.base_commits_ahead} commits behind · ` : ""}
                      {worker.warnings?.join(" · ")}
                    </text>
                  </Show>
                </box>
              )}
            </For>
          </Show>
        </scrollbox>
        <text fg={theme.text.muted}>j/k select · d start · z resize · p stop project · s/r/e worker · o issue · R refresh</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "redcode.workers",
  setup(context) {
    const [previous, setPrevious] = createSignal({ ...context.ui.router.current() })
    context.ui.router.register({
      name: ROUTE,
      render: () => <WorkersPage context={context} onClose={() => context.ui.router.navigate(previous())} />,
    })
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "workers.open",
            title: "RedSkills workers",
            group: "System",
            slash: { name: "workers" },
            palette: true,
            run() {
              const current = context.ui.router.current()
              if (current.type === "plugin" && current.name === ROUTE) return
              setPrevious({ ...current })
              context.ui.dialog.clear()
              context.ui.router.navigate({ type: "plugin", name: ROUTE })
            },
          }],
        }))
        return null
      },
    })
  },
})

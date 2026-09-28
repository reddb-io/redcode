import type { LocationRef, RedskilledStatusOutput } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { Status } from "@opencode/schema/redskilled"
import { Schema } from "effect"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { errorMessage } from "../../util/error"
import { openUrl } from "@opencode/util/open"
import { useComposerTab } from "../../routes/session/composer/context"
import { Keymap } from "../../context/keymap"

const ROUTE = "workers"

function WorkersPage(props: {
  context: Plugin.Context
  onClose: () => void
  sidebar?: boolean
  width?: number
  state: ReturnType<typeof createWorkerStatus>
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const [selectedID, setSelectedID] = createSignal<string>()
  const workers = createMemo(() => props.state.status()?.payload?.workers ?? [])
  const selectedIndex = createMemo(() =>
    Math.max(
      0,
      workers().findIndex((item) => item.worker_id === selectedID()),
    ),
  )
  const selected = createMemo(() => workers()[selectedIndex()])
  const width = () => props.width ?? Math.max(20, Math.min(110, dimensions().width - 4))

  const move = (offset: number) => {
    if (!workers().length) return
    setSelectedID(workers()[Math.max(0, Math.min(workers().length - 1, selectedIndex() + offset))].worker_id)
  }
  const startDrain = () =>
    props.state.run(
      () => props.context.client.redskilled.consent({ location: props.state.location(), decision: "accepted" }),
      "Project drain started",
    )
  const resize = async () => {
    const answer = await props.context.ui.dialog.prompt({
      title: "Resize project",
      value: String(props.state.status()?.activation?.target ?? 1),
      placeholder: "Worker target",
    })
    if (answer === undefined) return
    const target = Number(answer.trim())
    if (!Number.isInteger(target) || target < 0)
      return props.context.ui.toast.show({ variant: "error", message: "Target must be zero or greater" })
    await props.state.run(
      () => props.context.client.redskilled.project.resize({ location: props.state.location(), target }),
      `Project target set to ${target}`,
    )
  }
  const stopProject = async () => {
    if (!(await props.context.ui.dialog.confirm({ title: "Stop project", message: "Stop this project's drain?" })))
      return
    await props.state.run(
      () => props.context.client.redskilled.project.stop({ location: props.state.location() }),
      "Project drain stopped",
    )
  }
  const stopWorker = async () => {
    const worker = selected()
    if (
      !worker ||
      !(await props.context.ui.dialog.confirm({ title: "Stop worker", message: `Stop ${worker.worker_id}?` }))
    )
      return
    await props.state.run(
      () => props.context.client.redskilled.worker.stop({ location: props.state.location(), worker: worker.worker_id }),
      `Stopped ${worker.worker_id}`,
    )
  }
  const recycleWorker = async () => {
    const worker = selected()
    if (
      !worker ||
      !(await props.context.ui.dialog.confirm({ title: "Recycle worker", message: `Recycle ${worker.worker_id}?` }))
    )
      return
    await props.state.run(
      () =>
        props.context.client.redskilled.worker.recycle({ location: props.state.location(), worker: worker.worker_id }),
      `Recycling ${worker.worker_id}`,
    )
  }
  const steerWorker = async () => {
    const worker = selected()
    if (!worker) return
    const answer = await props.context.ui.dialog.prompt({
      title: `Steer ${worker.worker_id}`,
      placeholder: "What should this worker do next?",
    })
    const text = answer?.trim()
    if (!text) return
    await props.state.run(
      () =>
        props.context.client.redskilled.worker.steer({
          location: props.state.location(),
          worker: worker.worker_id,
          text,
        }),
      `Steer queued for ${worker.worker_id}`,
    )
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

  props.context.keymap.layer(() => ({
    enabled: () => !props.sidebar,
    commands: [
      { bind: "escape", title: "Back", group: "Workers", run: props.onClose },
      { bind: "j", title: "Next worker", group: "Workers", run: () => move(1) },
      { bind: "down", title: "Next worker", group: "Workers", run: () => move(1) },
      { bind: "k", title: "Previous worker", group: "Workers", run: () => move(-1) },
      { bind: "up", title: "Previous worker", group: "Workers", run: () => move(-1) },
      { bind: "R", title: "Refresh workers", group: "Workers", run: () => void props.state.load() },
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
    <box
      width="100%"
      height="100%"
      alignItems="center"
      backgroundColor={props.sidebar ? theme.background.raised.base : theme.background.base}
    >
      <box width={width()} flexGrow={1} minHeight={0} paddingTop={1} paddingBottom={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            {props.sidebar ? "Workers" : "RedSkills / Workers"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={props.onClose}>
            {props.sidebar ? "expand" : "esc back"}
          </text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={redskilledColor(theme, props.state.status())}>
            {redskilledLabel(props.state.status(), props.state.loading())}
            {props.state.status()?.activation?.project ? ` · ${props.state.status()!.activation!.project}` : ""}
          </text>
          <text fg={theme.text.muted}>
            {props.state.busy() ? "Working… · " : ""}
            {workers().length} workers
            {workers().some((item) => item.display?.failed)
              ? ` · ${workers().filter((item) => item.display?.failed).length} failed`
              : ""}
          </text>
        </box>
        <Show when={props.state.status()?.queue}>
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
        <Show when={props.state.status()?.error}>
          {(message) => (
            <text fg={theme.text.feedback.error.base} wrapMode="word">
              {message()}
            </text>
          )}
        </Show>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void startDrain()}>
            {props.sidebar ? "start" : "d start drain"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void resize()}>
            {props.sidebar ? "resize" : "z resize"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void stopProject()}>
            {props.sidebar ? "stop project" : "p stop project"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void props.state.load()}>
            {props.sidebar ? "refresh" : "R refresh"}
          </text>
        </box>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void stopWorker()}>
            {props.sidebar ? "stop worker" : "s stop"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void recycleWorker()}>
            {props.sidebar ? "recycle" : "r recycle"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={() => void steerWorker()}>
            {props.sidebar ? "steer" : "e steer"}
          </text>
          <text fg={theme.text.action.secondary.base} onMouseUp={openIssue}>
            {props.sidebar ? "issue" : "o issue"}
          </text>
        </box>
        <scrollbox flexGrow={1} minHeight={0} width="100%">
          <Show
            when={workers().length > 0}
            fallback={
              <text fg={theme.text.muted}>
                {props.state.status()?.lifecycle === "unavailable"
                  ? "Worker status is unavailable."
                  : "No live workers. Start the project drain when ready."}
              </text>
            }
          >
            <For each={workers()}>
              {(worker) => (
                <box
                  width="100%"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    worker.worker_id === selected()?.worker_id ? theme.background.formfield.selected : undefined
                  }
                  onMouseUp={() => setSelectedID(worker.worker_id)}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <text
                      fg={worker.worker_id === selected()?.worker_id ? theme.text.formfield.selected : theme.text.base}
                    >
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
                    <text
                      fg={worker.warnings?.length ? theme.text.feedback.warning.base : theme.text.muted}
                      wrapMode="word"
                    >
                      {worker.base_commits_ahead ? `${worker.base_commits_ahead} commits behind · ` : ""}
                      {worker.warnings?.join(" · ")}
                    </text>
                  </Show>
                </box>
              )}
            </For>
          </Show>
        </scrollbox>
        <Show when={!props.sidebar}>
          <text fg={theme.text.muted}>
            j/k select · d start · z resize · p stop project · s/r/e worker · o issue · R refresh
          </text>
        </Show>
      </box>
    </box>
  )
}

function WorkersTab(props: { state: ReturnType<typeof createWorkerStatus>; onOpen: () => void }) {
  const theme = useTheme()
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()
  const workers = createMemo(() => props.state.status()?.payload?.workers ?? [])
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined

  const move = (offset: number) => {
    if (!workers().length) return
    setSelected((index) => (index + offset + workers().length) % workers().length)
  }

  createEffect(() => {
    if (selected() >= workers().length) setSelected(Math.max(0, workers().length - 1))
    if (!scroll) return
    const target = scroll.getChildren()[selected()]
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height || y < 0) scroll.scrollBy(y - Math.floor(scroll.height / 2))
  })

  onMount(() => {
    const cleanup = composer.register({
      id: "workers",
      label: "Workers",
      hints: () => [
        { label: "manage", shortcut: shortcuts.get("composer.worker.open") ?? "" },
        { label: "refresh", shortcut: shortcuts.get("composer.worker.refresh") ?? "" },
      ],
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("workers"),
    priority: 1,
    commands: [
      { id: "composer.worker.up", title: "Previous worker", group: "Composer", run: () => move(-1) },
      { id: "composer.worker.down", title: "Next worker", group: "Composer", run: () => move(1) },
      { id: "composer.worker.open", title: "Manage workers", group: "Composer", run: props.onOpen },
      {
        id: "composer.worker.refresh",
        title: "Refresh workers",
        group: "Composer",
        run: () => void props.state.load(),
      },
    ],
  }))

  return (
    <Show when={composer.active("workers")}>
      <box gap={1}>
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
          <text fg={redskilledColor(theme, props.state.status())}>
            {redskilledLabel(props.state.status(), props.state.loading())}
            {props.state.status()?.activation?.project ? ` · ${props.state.status()!.activation!.project}` : ""}
          </text>
          <text fg={theme.text.muted}>
            {workers().length} worker{workers().length === 1 ? "" : "s"}
          </text>
        </box>
        <Show when={props.state.status()?.error}>
          {(message) => <text fg={theme.text.feedback.error.base}> {message()}</text>}
        </Show>
        <scrollbox scrollbarOptions={{ visible: false }} maxHeight={5} ref={(value) => (scroll = value)}>
          <Show
            when={workers().length > 0}
            fallback={
              <text fg={theme.text.muted}>
                {props.state.status()?.lifecycle === "unavailable"
                  ? " No worker status available"
                  : " No live workers. Press enter to manage the project drain."}
              </text>
            }
          >
            <For each={workers()}>
              {(worker, index) => {
                const active = () => index() === selected()
                return (
                  <box
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() ? theme.background.action.primary.focused : undefined}
                    onMouseMove={() => setSelected(index())}
                    onMouseUp={() => setSelected(index())}
                  >
                    <text
                      flexGrow={1}
                      fg={active() ? theme.text.action.primary.focused : theme.text.action.primary.base}
                      attributes={active() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {worker.worker_id} {worker.display?.issue ?? ""}
                    </text>
                    <text
                      fg={worker.display?.failed ? theme.text.feedback.error.base : theme.text.muted}
                      wrapMode="none"
                    >
                      {worker.display?.phase ?? (worker.display?.failed ? "failed" : "running")}
                    </text>
                  </box>
                )
              }}
            </For>
          </Show>
        </scrollbox>
        <Show when={workers()[selected()]}>
          {(worker) => (
            <text fg={theme.text.muted} paddingLeft={1} wrapMode="none">
              {worker().display?.step ?? "—"} · {worker().budget.declared ?? "no memory budget"} · pid {worker().pid}
            </text>
          )}
        </Show>
      </box>
    </Show>
  )
}

function redskilledLabel(status: Status | undefined, loading: boolean) {
  if (loading) return "Redskilled off · connecting"
  if (!status) return "Redskilled off"
  return `Redskilled ${status.lifecycle === "live" || status.lifecycle === "degraded" ? "on" : "off"} · ${status.lifecycle}`
}

function redskilledColor(theme: ReturnType<typeof useTheme>, status: Status | undefined) {
  if (status?.lifecycle === "live") return theme.text.feedback.success.base
  if (status?.lifecycle === "degraded" || status?.lifecycle === "connecting") return theme.text.feedback.warning.base
  if (status?.lifecycle === "unavailable" || status?.lifecycle === "refused") return theme.text.feedback.error.base
  return theme.text.muted
}

// The drawer and full page observe one project poll and mutation state.
function createWorkerStatus(context: Plugin.Context, location: () => LocationRef) {
  const [status, setStatus] = createSignal<Status>()
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  let polling = false
  let revision = 0
  const load = async () => {
    if (busy() || polling) return
    polling = true
    const observed = revision
    try {
      const result = await context.client.redskilled.status({ location: location(), scope: "project" })
      if (revision === observed) setStatus(Schema.decodeUnknownSync(Status)(result.data))
    } catch (cause) {
      if (revision === observed)
        setStatus({
          lifecycle: "unavailable",
          consent: "unknown",
          scope: "project",
          native: true,
          error: errorMessage(cause),
        })
    } finally {
      polling = false
      if (revision === observed) setLoading(false)
      if (revision !== observed) void load()
    }
  }
  const run = async (action: () => Promise<RedskilledStatusOutput>, message: string) => {
    if (busy()) return
    const observed = ++revision
    setBusy(true)
    try {
      const result = await action()
      if (revision === observed) setStatus(Schema.decodeUnknownSync(Status)(result.data))
      context.ui.toast.show({ variant: "success", message })
    } catch (cause) {
      context.ui.toast.show({ variant: "error", message: errorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }
  createEffect(
    on(location, () => {
      revision++
      setStatus(undefined)
      setLoading(true)
      void load()
    }),
  )
  const timer = setInterval(() => void load(), 5_000)
  onCleanup(() => clearInterval(timer))
  return { location, status, loading, busy, load, run }
}

export default Plugin.define({
  id: "redcode.workers",
  setup(context) {
    const [previous, setPrevious] = createSignal({ ...context.ui.router.current() })
    const location = createMemo(() => {
      const current = context.ui.router.current()
      const source = current.type === "session" ? current : previous()
      return (
        (source.type === "session" ? context.data.session.get(source.sessionID)?.location : undefined) ??
        context.location ??
        context.data.location.default()
      )
    })
    const state = createWorkerStatus(context, location)
    context.ui.slot({
      append: "session.composer.tabs",
      render: () => (
        <WorkersTab
          state={state}
          onOpen={() => {
            setPrevious({ ...context.ui.router.current() })
            context.ui.router.navigate({ type: "plugin", name: ROUTE })
          }}
        />
      ),
    })
    context.ui.router.register({
      name: ROUTE,
      render: () => (
        <WorkersPage context={context} state={state} onClose={() => context.ui.router.navigate(previous())} />
      ),
    })
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "workers.open",
              title: "RedSkills workers",
              group: "System",
              slash: { name: "workers" },
              palette: true,
              run() {
                const current = context.ui.router.current()
                if (current.type === "session") {
                  context.keymap.dispatch("session.composer.workers")
                  context.ui.dialog.clear()
                  return
                }
                if (current.type === "plugin" && current.name === ROUTE) return
                setPrevious({ ...current })
                context.ui.dialog.clear()
                context.ui.router.navigate({ type: "plugin", name: ROUTE })
              },
            },
          ],
        }))
        return null
      },
    })
  },
})

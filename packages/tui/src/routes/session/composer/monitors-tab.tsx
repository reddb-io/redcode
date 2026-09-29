import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { MonitorPublicInfo, OpenCodeClient } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useClient } from "../../../context/client"
import { useData } from "../../../context/data"
import { useTheme } from "../../../context/theme"
import { Keymap } from "../../../context/keymap"
import { useDialog } from "../../../ui/dialog"
import { DialogConfirm } from "../../../ui/dialog-confirm"
import { useToast } from "../../../ui/toast"
import { errorMessage } from "../../../util/error"
import { useComposerTab } from "./context"
import {
  MONITOR_POLL_MS,
  finishToast,
  finishedMonitors,
  monitorDelivery,
  monitorDetail,
  monitorState,
  monitorSummary,
  monitorTarget,
  monitorsIndicator,
  sortMonitors,
  timeLeft,
  type MonitorTone,
} from "./monitors-model"

export type MonitorApi = Pick<OpenCodeClient["session"]["monitor"], "list" | "cancel">

/** One Session's monitors, shared by the Monitors tab, the prompt footer indicator and the finish toasts. */
export type SessionMonitors = ReturnType<typeof createSessionMonitors>

/**
 * Monitor changes are not published as client events, so the list is read once on mount, again when a tool
 * result or a delivered completion names a monitor or the Session goes idle, and on a light timer only while
 * the Monitors tab is on screen or a monitor still runs. A Session without monitors costs one read per run.
 */
export function createSessionMonitors(props: { sessionID: () => string; onOpen: () => void; api?: MonitorApi }) {
  const client = useClient()
  const data = useData()
  const toast = useToast()
  const api = () => props.api ?? client.api.session.monitor
  const [store, setStore] = createStore({
    list: [] as MonitorPublicInfo[],
    error: undefined as string | undefined,
    now: Date.now(),
    visible: false,
  })
  let loading = false

  const refresh = () => {
    if (loading) return
    loading = true
    const sessionID = props.sessionID()
    void api()
      .list({ sessionID })
      .then(
        (list) => {
          if (sessionID !== props.sessionID()) return
          if (!store.visible)
            finishedMonitors(store.list, list).forEach((info) =>
              toast.show({ ...finishToast(info), duration: 3_000, action: { label: "view", run: props.onOpen } }),
            )
          setStore("list", reconcile(list, { key: "id" }))
          setStore({ error: undefined, now: Date.now() })
        },
        (error: unknown) => setStore("error", errorMessage(error)),
      )
      .finally(() => {
        loading = false
      })
  }

  createEffect(on(props.sessionID, refresh))
  createEffect(() => {
    if (!store.visible && !store.list.some((info) => info.status === "running")) return
    const timer = setInterval(() => {
      setStore("now", Date.now())
      refresh()
    }, MONITOR_POLL_MS)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(
    on(
      () => data.session.status(props.sessionID()),
      (status, previous) => {
        if (previous === "running" && status !== "running") refresh()
      },
      { defer: true },
    ),
  )
  onCleanup(
    client.event.on("session.tool.success", (event) => {
      if (event.data.sessionID !== props.sessionID()) return
      // Every monitor tool call, start or control, answers with a rendered monitor_result.
      if (event.data.content.some((part) => part.type === "text" && part.text.includes('"monitor_result"'))) refresh()
    }),
  )
  onCleanup(
    client.event.on("session.inbox.enqueued", (event) => {
      if (event.data.sessionID !== props.sessionID() || event.data.item.type !== "synthetic") return
      if (event.data.item.payload.metadata?.source === "monitor") refresh()
    }),
  )

  return {
    list: () => store.list,
    error: () => store.error,
    now: () => store.now,
    refresh,
    /** The Monitors tab reports whether it is on screen: polling keeps up while it is, and finish toasts stay quiet. */
    show: (visible: boolean) => setStore("visible", visible),
    cancel: (info: MonitorPublicInfo) =>
      api()
        .cancel({ sessionID: props.sessionID(), monitorID: info.id })
        .then(
          (updated) => {
            // Settled locally, so the next read does not announce this cancellation as a finish.
            setStore("list", (item) => item.id === updated.id, reconcile(updated))
            toast.show({ variant: "success", message: `Stopped monitoring ${monitorTarget(updated)}` })
          },
          (error: unknown) => toast.error(error),
        ),
  }
}

export function MonitorsIndicator(props: { monitors: SessionMonitors; onOpen: () => void }) {
  const theme = useTheme()
  return (
    <Show when={monitorsIndicator(props.monitors.list())}>
      {(label) => (
        <text
          id="prompt.footer.monitors"
          fg={theme.text.feedback.info.base}
          wrapMode="none"
          flexShrink={0}
          onMouseUp={props.onOpen}
        >
          {label()}
        </text>
      )}
    </Show>
  )
}

export function MonitorsTab(props: { monitors: SessionMonitors }) {
  const theme = useTheme()
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()
  const dialog = useDialog()
  const monitors = createMemo(() => sortMonitors(props.monitors.list()))
  const [selectedID, setSelectedID] = createSignal<string>()
  const [expanded, setExpanded] = createSignal<string>()
  // Selection follows the monitor, not its row: a finish reorders the list.
  const selected = createMemo(() =>
    Math.max(
      0,
      monitors().findIndex((info) => info.id === selectedID()),
    ),
  )
  const current = createMemo(() => monitors()[selected()])
  const detail = createMemo(() => monitors().find((info) => info.id === expanded()))
  const tone = (value: MonitorTone) => (value === "muted" ? theme.text.muted : theme.text.feedback[value].base)
  let scroll: ScrollBoxRenderable | undefined

  createEffect(
    on(
      () => composer.active("monitors"),
      (visible) => {
        props.monitors.show(visible)
        if (visible) props.monitors.refresh()
      },
    ),
  )
  onCleanup(() => props.monitors.show(false))
  createEffect(() => {
    if (!scroll || !composer.active("monitors")) return
    const target = scroll.getChildren()[selected()]
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height || y < 0) scroll.scrollBy(y - Math.floor(scroll.height / 2))
  })

  const move = (step: number) => {
    const list = monitors()
    if (list.length === 0) return
    setSelectedID(list[Math.min(list.length - 1, Math.max(0, selected() + step))]?.id)
  }

  const toggle = (info: MonitorPublicInfo) => setExpanded(expanded() === info.id ? undefined : info.id)

  const cancel = (info: MonitorPublicInfo) => {
    if (info.status !== "running") return
    dialog.replace(() => (
      <DialogConfirm
        title="Stop monitoring"
        message={`Stop observing ${monitorTarget(info)}? The external job keeps running.`}
        onConfirm={() => void props.monitors.cancel(info)}
      />
    ))
  }

  onMount(() => {
    const cleanup = composer.register({
      id: "monitors",
      label: "Monitors",
      hints: () => [
        ...(current()
          ? [
              {
                label: expanded() === current()?.id ? "hide evidence" : "evidence",
                shortcut: shortcuts.get("composer.monitor.evidence") ?? "",
              },
            ]
          : []),
        ...(current()?.status === "running"
          ? [{ label: "stop", shortcut: shortcuts.get("composer.monitor.cancel") ?? "" }]
          : []),
        { label: "refresh", shortcut: shortcuts.get("composer.monitor.refresh") ?? "" },
      ],
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("monitors"),
    priority: 1,
    commands: [
      { id: "composer.monitor.up", title: "Previous monitor", group: "Composer", run: () => move(-1) },
      { id: "composer.monitor.down", title: "Next monitor", group: "Composer", run: () => move(1) },
      {
        id: "composer.monitor.evidence",
        title: "Show monitor evidence",
        group: "Composer",
        run: () => {
          const info = current()
          if (info) toggle(info)
        },
      },
      {
        id: "composer.monitor.cancel",
        title: "Stop monitoring",
        group: "Composer",
        run: () => {
          const info = current()
          if (info) cancel(info)
        },
      },
      { id: "composer.monitor.refresh", title: "Refresh monitors", group: "Composer", run: props.monitors.refresh },
    ],
  }))

  return (
    <Show when={composer.active("monitors")}>
      <Show
        when={monitors().length > 0}
        fallback={
          <box height={2} paddingLeft={1}>
            <text fg={props.monitors.error() ? theme.text.feedback.error.base : theme.text.muted}>
              {props.monitors.error()
                ? `Could not load monitors: ${props.monitors.error()}`
                : "No monitors in this session"}
            </text>
          </box>
        }
      >
        <scrollbox
          scrollbarOptions={{ visible: false }}
          maxHeight={6}
          ref={(value: ScrollBoxRenderable) => (scroll = value)}
        >
          <For each={monitors()}>
            {(info, index) => {
              const active = createMemo(() => selected() === index())
              const state = createMemo(() => monitorState(info.status))
              return (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    active() ? theme.background.action.primary.focused : theme.background.action.primary.base
                  }
                  onMouseMove={() => setSelectedID(info.id)}
                  onMouseUp={() => {
                    setSelectedID(info.id)
                    toggle(info)
                  }}
                >
                  <box flexDirection="row" gap={1}>
                    <text
                      fg={active() ? theme.text.action.primary.focused : theme.text.action.primary.base}
                      attributes={active() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                      truncate
                      flexGrow={1}
                      flexShrink={1}
                    >
                      {expanded() === info.id ? "▾" : "▸"} {monitorTarget(info)}
                    </text>
                    <text fg={tone(state().tone)} wrapMode="none" flexShrink={0}>
                      {state().label}
                    </text>
                    <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
                      {timeLeft(info, props.monitors.now()) ?? monitorDelivery(info.delivery)}
                    </text>
                  </box>
                  <text fg={theme.text.muted} wrapMode="none" truncate>
                    {"  "}
                    {monitorSummary(info)}
                  </text>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
      <Show when={detail()}>
        {(info) => (
          <scrollbox maxHeight={10} paddingLeft={2} paddingRight={2}>
            <text fg={theme.text.muted} wrapMode="word">
              {monitorDetail(info())}
            </text>
          </scrollbox>
        )}
      </Show>
      <Show when={current()}>
        {(info) => (
          <box flexDirection="row" gap={2} paddingLeft={1}>
            <text
              id={`monitor-evidence-${info().id}`}
              fg={theme.text.action.primary.base}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() => toggle(info())}
            >
              {expanded() === info().id ? "hide evidence" : "evidence"}
            </text>
            <Show when={info().status === "running"}>
              <text
                id={`monitor-stop-${info().id}`}
                fg={theme.text.action.destructive.base}
                attributes={TextAttributes.UNDERLINE}
                onMouseUp={() => cancel(info())}
              >
                stop
              </text>
            </Show>
          </box>
        )}
      </Show>
    </Show>
  )
}

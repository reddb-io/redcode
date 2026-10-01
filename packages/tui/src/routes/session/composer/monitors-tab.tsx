import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { MonitorPublicInfo, OpenCodeClient } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useClient } from "../../../context/client"
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
 * The list is read once per Session, again whenever the server announces that one of its monitors started,
 * finished or expired, and when the Monitors tab opens. Attempts and evidence change without an event, so
 * only while the tab is on screen and a monitor still runs is it re-read on a light timer.
 */
export function createSessionMonitors(props: { sessionID: () => string; onOpen: () => void; api?: MonitorApi }) {
  const client = useClient()
  const toast = useToast()
  const api = () => props.api ?? client.api.session.monitor
  const [store, setStore] = createStore({
    list: [] as MonitorPublicInfo[],
    error: undefined as string | undefined,
    now: Date.now(),
    visible: false,
  })
  // A change announced while a read is in flight is read once more when it settles, so it is never lost.
  const reading = { active: false, again: false }

  const refresh = () => {
    if (reading.active) {
      reading.again = true
      return
    }
    reading.active = true
    const sessionID = props.sessionID()
    void api()
      .list({ sessionID })
      .then(
        (list) => {
          if (sessionID !== props.sessionID()) return
          if (!store.visible)
            finishedMonitors(store.list, list).forEach((info) => toast.show({ ...finishToast(info), duration: 3_000 }))
          setStore("list", reconcile(list, { key: "id" }))
          setStore({ error: undefined, now: Date.now() })
        },
        (error: unknown) => setStore("error", errorMessage(error)),
      )
      .finally(() => {
        reading.active = false
        if (!reading.again) return
        reading.again = false
        refresh()
      })
  }

  createEffect(on(props.sessionID, refresh))
  createEffect(() => {
    if (!store.visible || !store.list.some((info) => info.status === "running")) return
    const timer = setInterval(() => {
      setStore("now", Date.now())
      refresh()
    }, MONITOR_POLL_MS)
    onCleanup(() => clearInterval(timer))
  })
  const changed = (event: { data: { sessionID: string } }) => {
    if (event.data.sessionID === props.sessionID()) refresh()
  }
  onCleanup(client.event.on("monitor.started", changed))
  onCleanup(client.event.on("monitor.finished", changed))
  onCleanup(client.event.on("monitor.expired", changed))

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
  // Selection follows the monitor while live rows arrive and leave.
  const selected = createMemo(() =>
    Math.max(
      0,
      monitors().findIndex((info) => info.id === selectedID()),
    ),
  )
  const current = createMemo(() => monitors()[selected()])
  createEffect(() => {
    const list = monitors()
    if (selectedID() && !list.some((info) => info.id === selectedID())) setSelectedID(list[0]?.id)
    if (expanded() && !list.some((info) => info.id === expanded())) setExpanded(undefined)
  })
  const tone = (value: MonitorTone) => (value === "muted" ? theme.text.muted : theme.text.feedback[value].base)
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()

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
    const area = scroll()
    if (!area || !composer.active("monitors")) return
    const rows = area.getChildren()
    if (!rows[selected()]) return
    // Culled rows can retain old screen coordinates. Their layout heights still locate the header in the content.
    const top = rows.slice(0, selected()).reduce((height, row) => height + row.height, 0)
    if (top < area.scrollTop) area.scrollTo(top)
    if (top >= area.scrollTop + area.height) area.scrollTo(top - Math.floor(area.height / 2))
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
                id: `monitor-evidence-${current()!.id}`,
                label: expanded() === current()?.id ? "hide evidence" : "evidence",
                shortcut: shortcuts.get("composer.monitor.evidence") ?? "",
                onSelect: () => toggle(current()!),
              },
            ]
          : []),
        ...(current()?.status === "running"
          ? [
              {
                id: `monitor-stop-${current()!.id}`,
                label: "stop",
                tone: "destructive" as const,
                shortcut: shortcuts.get("composer.monitor.cancel") ?? "",
                onSelect: () => cancel(current()!),
              },
            ]
          : []),
        { label: "scroll", shortcut: "pgup/pgdn" },
        {
          label: "refresh",
          shortcut: shortcuts.get("composer.monitor.refresh") ?? "",
          onSelect: props.monitors.refresh,
        },
      ],
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("monitors"),
    priority: 1,
    commands: [
      {
        bind: "pageup",
        title: "Previous monitor evidence page",
        group: "Composer",
        run: () => scroll()?.scrollBy(-(scroll()?.height ?? 0)),
      },
      {
        bind: "pagedown",
        title: "Next monitor evidence page",
        group: "Composer",
        run: () => scroll()?.scrollBy(scroll()?.height ?? 0),
      },
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
          <box height={5}>
            <text fg={props.monitors.error() ? theme.text.feedback.error.base : theme.text.muted}>
              {props.monitors.error()
                ? ` Could not load monitors: ${props.monitors.error()}`
                : " No active monitors in this session"}
            </text>
          </box>
        }
      >
        <scrollbox
          id="composer-monitors-scroll"
          scrollY
          scrollX={false}
          horizontalScrollbarOptions={{ visible: false }}
          height={5}
          minHeight={0}
          flexShrink={0}
          ref={setScroll}
        >
          <For each={monitors()}>
            {(info, index) => {
              const active = createMemo(() => selected() === index())
              const state = createMemo(() => monitorState(info.status))
              return (
                <box
                  flexShrink={0}
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
                  <Show when={expanded() === info.id}>
                    <box paddingLeft={1} flexShrink={0}>
                      <text fg={theme.text.muted} wrapMode="word">
                        {monitorDetail(info)}
                      </text>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </Show>
  )
}

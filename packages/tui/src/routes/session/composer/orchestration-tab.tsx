import { BoxRenderable, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useClient } from "../../../context/client"
import { useData } from "../../../context/data"
import { Keymap } from "../../../context/keymap"
import { useRoute } from "../../../context/route"
import { useTheme } from "../../../context/theme"
import { useDialog } from "../../../ui/dialog"
import { DialogConfirm } from "../../../ui/dialog-confirm"
import { DialogPrompt } from "../../../ui/dialog-prompt"
import { useToast } from "../../../ui/toast"
import { useComposerTab } from "./context"
import { OrchestrationView, OrchestrationDetails, orchestrationTree } from "./orchestration-view"

export function OrchestrationTab(props: { sessionID: string }) {
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  const composer = useComposerTab()
  const dimensions = useTerminalDimensions()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const shortcuts = Keymap.useShortcuts()
  const [state, setState] = createStore({ selected: props.sessionID, width: dimensions().width - 8, details: false })
  const active = () => composer.active("orchestration")
  const nodes = createMemo(() =>
    [...new Set([data.session.root(props.sessionID), ...data.session.family(props.sessionID)])].flatMap((id) => {
      const session = data.session.get(id)
      if (!session) return []
      const permissions = data.session.permission.list(id)
      const forms = data.session.form.list(id)
      return [
        {
          session,
          status: data.session.status(id),
          requests: permissions && forms ? permissions.length + forms.length : undefined,
        },
      ]
    }),
  )
  const selected = () => nodes().find((node) => node.session.id === state.selected)
  const rows = createMemo(() => orchestrationTree(nodes(), data.session.root(props.sessionID)))
  createEffect(
    on(
      () => props.sessionID,
      (id) => setState("selected", id),
    ),
  )
  const request = { controller: undefined as AbortController | undefined }
  const target = createMemo(
    () => (active() && state.details && selected() ? { id: state.selected, status: selected()!.status } : undefined),
    undefined,
    { equals: (previous, next) => previous?.id === next?.id && previous?.status === next?.status },
  )
  const [reading, { refetch }] = createResource(target, async (input) => {
    request.controller?.abort()
    const controller = new AbortController()
    request.controller = controller
    const [intelligence, evaluations] = await Promise.all([
      client.api["server.intelligence"].status({ sessionID: input.id }, { signal: controller.signal }),
      client.api["server.intelligence"].history({ sessionID: input.id, limit: 6 }, { signal: controller.signal }),
    ])
    return { id: input.id, intelligence, evaluations }
  })
  createEffect(() => {
    if (!active() || !state.details) request.controller?.abort()
  })
  onCleanup(() => request.controller?.abort())
  const snapshot = () => (!reading.error && reading()?.id === state.selected ? reading() : undefined)
  const elements = new Map<string, BoxRenderable>()
  let scroll: ScrollBoxRenderable | undefined
  const reveal = () => {
    const element = elements.get(state.selected)
    if (!scroll || !element || element.isDestroyed) return
    const top = element.y - scroll.content.y
    const bottom = top + element.height
    if (top < scroll.scrollTop) scroll.scrollTo(top)
    if (bottom > scroll.scrollTop + scroll.viewport.height)
      scroll.scrollTo(Math.max(0, bottom - scroll.viewport.height))
  }
  // A resized/remounted scrollbox resets its position during the next layout frame.
  createEffect(() => {
    if (!active()) return
    state.selected
    if (state.details) {
      scroll?.scrollTo(0)
      return
    }
    state.width
    dimensions().height
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(reveal)
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })
  const move = (delta: number) => {
    const list = rows().map((row) => row.node)
    if (!list.length) return
    const index = list.findIndex((node) => node.session.id === state.selected)
    setState("selected", list[(Math.max(index, 0) + delta + list.length) % list.length].session.id)
  }
  const steer = () => {
    const node = selected()
    if (!node || node.status !== "running") return
    const id = node.session.id
    dialog.replace(() => (
      <DialogPrompt
        title="Steer selected agent"
        placeholder="What should it do differently?"
        onCancel={() => dialog.clear()}
        onConfirm={(text) => {
          if (!text.trim()) return
          dialog.clear()
          void client.api.session
            .prompt({ sessionID: id, text: text.trim(), delivery: "steer" })
            .then(() => toast.show({ variant: "success", message: "Instruction sent to the selected agent" }))
            .catch(toast.error)
        }}
      />
    ))
  }
  const interrupt = () => {
    const node = selected()
    if (!node || node.status !== "running") return
    const id = node.session.id
    dialog.replace(() => (
      <DialogConfirm
        title="Interrupt selected agent"
        message={`Interrupt ${node.session.title || id}?`}
        onConfirm={() => void client.api.session.interrupt({ sessionID: id }).catch(toast.error)}
      />
    ))
  }
  onMount(() => {
    const dispose = composer.register({
      id: "orchestration",
      label: "Orchestration",
      hints: () => [
        {
          label: "agent",
          shortcut: [shortcuts.get("composer.orchestration.up"), shortcuts.get("composer.orchestration.down")]
            .filter(Boolean)
            .join("/"),
        },
        { label: "open", shortcut: shortcuts.get("composer.orchestration.open") ?? "" },
        { label: state.details ? "back" : "details", shortcut: shortcuts.get("composer.orchestration.details") ?? "" },
        ...(selected()?.status === "running"
          ? [
              { label: "steer", shortcut: shortcuts.get("composer.orchestration.steer") ?? "" },
              {
                label: "interrupt",
                shortcut: shortcuts.get("composer.orchestration.interrupt") ?? "",
                tone: "destructive" as const,
              },
            ]
          : []),
        ...(state.details
          ? [{ label: "refresh", shortcut: shortcuts.get("composer.orchestration.refresh") ?? "" }]
          : []),
        ...(state.details || rows().length > Math.max(1, Math.min(12, dimensions().height - 18))
          ? [
              {
                label: "scroll",
                shortcut: [
                  shortcuts.get("composer.orchestration.page-up"),
                  shortcuts.get("composer.orchestration.page-down"),
                ]
                  .filter(Boolean)
                  .join("/"),
              },
            ]
          : []),
      ],
    })
    onCleanup(dispose)
  })
  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: active,
    priority: 1,
    commands: [
      {
        id: "composer.orchestration.details",
        title: "Toggle selected agent details",
        group: "Composer",
        run: () => setState("details", (value) => !value),
      },
      {
        id: "composer.orchestration.up",
        title: "Previous orchestration agent",
        group: "Composer",
        run: () => move(-1),
      },
      { id: "composer.orchestration.down", title: "Next orchestration agent", group: "Composer", run: () => move(1) },
      {
        id: "composer.orchestration.open",
        title: "Open selected orchestration session",
        group: "Composer",
        run: () => {
          if (selected()) route.navigate({ type: "session", sessionID: state.selected })
        },
      },
      {
        id: "composer.orchestration.steer",
        title: "Steer selected orchestration agent",
        group: "Composer",
        run: steer,
      },
      {
        id: "composer.orchestration.interrupt",
        title: "Interrupt selected orchestration agent",
        group: "Composer",
        run: interrupt,
      },
      {
        id: "composer.orchestration.refresh",
        title: "Refresh orchestration evaluations",
        group: "Composer",
        run: () => {
          if (state.details) void refetch()
        },
      },
      {
        id: "composer.orchestration.page-up",
        title: "Scroll orchestration up",
        group: "Composer",
        run: () => scroll?.scrollBy(-Math.max(1, scroll.viewport.height - 1)),
      },
      {
        id: "composer.orchestration.page-down",
        title: "Scroll orchestration down",
        group: "Composer",
        run: () => scroll?.scrollBy(Math.max(1, scroll.viewport.height - 1)),
      },
    ],
  }))
  return (
    <Show when={active()}>
      <box
        gap={1}
        minWidth={0}
        maxWidth={96}
        onSizeChange={function (this: BoxRenderable) {
          setState("width", this.width)
        }}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            {state.details ? "Agent details" : "Execution"}
          </text>
          <Show when={!state.details}>
            <text fg={theme.text.muted}>
              {rows().length} sessions · {nodes().filter((node) => node.status === "running").length} running
            </text>
          </Show>
        </box>
        <scrollbox
          ref={scroll}
          height={
            state.details
              ? Math.max(4, Math.min(20, dimensions().height - 18))
              : Math.max(1, Math.min(rows().length, 12, dimensions().height - 18))
          }
          minHeight={1}
          scrollbarOptions={{ visible: false }}
        >
          <Show
            when={state.details}
            fallback={
              <OrchestrationView
                rows={rows()}
                selected={state.selected}
                select={(id) => setState("selected", id)}
                register={(id, element) => elements.set(id, element)}
              />
            }
          >
            <Show when={selected()}>
              {(node) => (
                <OrchestrationDetails
                  node={node()}
                  server={client.endpoint?.url ? new URL(client.endpoint.url).host : "current connection"}
                  intelligence={snapshot()?.intelligence}
                  evaluations={snapshot()?.evaluations}
                  loading={reading.loading}
                  error={!!reading.error}
                />
              )}
            </Show>
          </Show>
        </scrollbox>
        <box>
          <Show when={state.details && reading.error}>
            <text fg={theme.text.feedback.warning.base} wrapMode="none">
              Evaluation data is unavailable. Refresh to retry.
            </text>
          </Show>
          <Show when={!selected()}>
            <text fg={theme.text.feedback.warning.base}>
              Selected agent is no longer available. Choose another explicitly.
            </text>
          </Show>
          <Show when={!state.details && selected()}>
            {(node) => (
              <>
                <text fg={theme.text.muted} wrapMode="none">
                  Model:{" "}
                  {node().session.model
                    ? `${node().session.model!.providerID} / ${node().session.model!.id}`
                    : "not recorded"}
                </text>
              </>
            )}
          </Show>
        </box>
      </box>
    </Show>
  )
}

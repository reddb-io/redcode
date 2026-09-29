import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
import { useRoute, useRouteData } from "../../../context/route"
import { useData } from "../../../context/data"
import { useClient } from "../../../context/client"
import { useTheme } from "../../../context/theme"
import { Locale } from "../../../util/locale"
import { Keymap } from "../../../context/keymap"
import { useComposerTab } from "./context"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { sessionFamily } from "../../../util/session"
import { useDialog } from "../../../ui/dialog"
import { DialogConfirm } from "../../../ui/dialog-confirm"
import { DialogPrompt } from "../../../ui/dialog-prompt"
import { useToast } from "../../../ui/toast"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { SubagentVerdict } from "../subagent"

interface SubagentEntry {
  sessionID: string
  agent: string
  title: string
  status: string
  current: boolean
  prefix: string
  model?: string
  decision?: SubagentReview.Decision
}

export function SubagentsTab(props: { sessionID: string }) {
  const route = useRouteData("session")
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  const navigate = useRoute().navigate
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()
  const dialog = useDialog()
  const toast = useToast()

  const session = createMemo(() => data.session.get(props.sessionID))
  const [store, setStore] = createStore({ selected: 0, active: true })

  const entries = createMemo<SubagentEntry[]>(() => {
    const current = session()
    if (!current) return []

    const result = sessionFamily<SessionInfo>(data.session.list(), current.id).map(
      ({ session, prefix }): SubagentEntry => {
        const title = withTimestampedFallback(session)
        const agentMatch = title.match(/@(\w+) subagent/)
        return {
          sessionID: session.id,
          agent: session.agent
            ? Locale.titlecase(session.agent)
            : agentMatch
              ? Locale.titlecase(agentMatch[1])
              : "Subagent",
          title: agentMatch ? title.replace(agentMatch[0], "").trim() || title : title,
          status: data.session.status(session.id),
          current: session.id === route.sessionID,
          prefix,
          model: session.model
            ? `${session.model.id}${session.model.variant ? ` (${session.model.variant})` : ""}`
            : undefined,
          decision: SubagentReview.read(session.metadata)?.result?.decision,
        }
      },
    )

    return result.filter((entry) => (store.active ? entry.status === "running" : entry.status !== "running"))
  })

  let selectedSessionID = ""
  let wasActive = false
  let scroll: ScrollBoxRenderable | undefined

  const selectedEntry = createMemo(() => entries()[store.selected])

  const steer = (entry: SubagentEntry) => {
    dialog.replace(() => (
      <DialogPrompt
        title="Steer subagent"
        placeholder="What should it do differently?"
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const text = value.trim()
          if (!text) return
          dialog.clear()
          void client.api.session
            .prompt({ sessionID: entry.sessionID, text, delivery: "steer" })
            .then(() => toast.show({ variant: "success", message: "Hint sent to the subagent" }))
            .catch(toast.error)
        }}
      />
    ))
  }

  const kill = (entry: SubagentEntry) => {
    dialog.replace(() => (
      <DialogConfirm
        title="Kill subagent"
        message={`Abort ${entry.title}?`}
        onConfirm={() => void client.api.session.interrupt({ sessionID: entry.sessionID }).catch(toast.error)}
      />
    ))
  }

  createEffect(() => {
    const active = composer.active("subagents")
    if (!active) {
      if (wasActive) {
        selectedSessionID = ""
        setStore({ selected: 0, active: true })
      }
      wasActive = false
      return
    }
    const list = entries()
    if (selectedSessionID !== route.sessionID && list.length > 0) {
      const currentIdx = list.findIndex((e) => e.current)
      const next = currentIdx >= 0 ? currentIdx : 0
      selectedSessionID = route.sessionID
      setStore("selected", next)
      const scrollCurrentIntoView = () => scrollToIndex(next, true)
      scrollCurrentIntoView()
      // The remounted scrollbox finishes layout on the next frame and resets its scroll position.
      requestAnimationFrame(() => requestAnimationFrame(scrollCurrentIntoView))
    }
    wasActive = true
    if (store.selected >= list.length) moveTo(Math.max(0, list.length - 1))
  })

  function moveTo(next: number, center = false) {
    setStore("selected", next)
    scrollToIndex(next, center)
  }

  function scrollToIndex(index: number, center: boolean) {
    if (!scroll) return
    if (center) {
      scroll.scrollTo(Math.max(0, index - Math.floor(scroll.viewport.height / 2)))
      return
    }
    if (index >= scroll.scrollTop + scroll.viewport.height) {
      scroll.scrollTo(index - scroll.viewport.height + 1)
    }
    if (index < scroll.scrollTop) {
      scroll.scrollTo(index)
      if (index === 0) scroll.scrollTo(0)
    }
  }

  onMount(() => {
    const cleanup = composer.register({
      id: "subagents",
      label: "Subagents",
      hints: () => {
        const entry = selectedEntry()
        return [
          ...(entry?.status === "running"
            ? [
                { label: "steer", shortcut: shortcuts.get("composer.subagent.steer") ?? "" },
                { label: "kill", shortcut: shortcuts.get("composer.subagent.interrupt") ?? "" },
              ]
            : []),
          {
            label: `show ${store.active ? "inactive" : "active"}`,
            shortcut: shortcuts.get("composer.subagent.toggle-activity") ?? "",
          },
        ]
      },
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("subagents"),
    priority: 1,
    commands: [
      {
        id: "composer.subagent.up",
        title: "Previous subagent",
        group: "Composer",
        run() {
          if (store.selected === 0) {
            composer.close()
            return
          }
          moveTo(store.selected - 1, true)
        },
      },
      {
        id: "composer.subagent.down",
        title: "Next subagent",
        group: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          moveTo((store.selected + 1) % list.length, true)
        },
      },
      {
        id: "composer.subagent.select",
        title: "Navigate to subagent",
        group: "Composer",
        run() {
          const entry = entries()[store.selected]
          if (entry) navigate({ type: "session", sessionID: entry.sessionID })
        },
      },
      {
        id: "composer.subagent.toggle-activity",
        title: "Toggle active subagents",
        group: "Composer",
        bind: "ctrl+a",
        run() {
          setStore({ selected: 0, active: !store.active })
          scroll?.scrollTo(0)
        },
      },
      {
        id: "composer.subagent.steer",
        title: "Steer subagent",
        group: "Composer",
        run() {
          const entry = selectedEntry()
          if (entry?.status === "running") steer(entry)
        },
      },
      {
        id: "composer.subagent.interrupt",
        title: "Interrupt subagent",
        group: "Composer",
        run() {
          const entry = selectedEntry()
          if (entry?.status === "running") kill(entry)
        },
      },
    ],
  }))

  return (
    <Show when={composer.active("subagents")}>
      <scrollbox scrollbarOptions={{ visible: false }} maxHeight={5} ref={(r: ScrollBoxRenderable) => (scroll = r)}>
        <Show
          when={entries().length > 0}
          fallback={<text fg={theme.text.muted}> No {store.active ? "active" : "inactive"} subagents</text>}
        >
          <For each={entries()}>
            {(entry, index) => {
              const active = createMemo(() => index() === store.selected)
              const status = createMemo(() => {
                if (entry.status === "running") return "Running"
                return ""
              })
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    active()
                      ? theme.background.action.primary.focused
                      : entry.current
                        ? theme.background.action.primary.selected
                        : theme.background.action.primary.base
                  }
                  onMouseMove={() => setStore("selected", index())}
                  onMouseUp={() => setStore("selected", index())}
                >
                  <box flexGrow={1} minWidth={0} flexDirection="row">
                    <text
                      fg={
                        active()
                          ? theme.text.action.primary.focused
                          : entry.current
                            ? theme.text.action.primary.selected
                            : theme.text.action.primary.base
                      }
                      attributes={active() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {entry.prefix}
                      {entry.agent}: {entry.title}
                    </text>
                  </box>
                  <Show when={status()}>
                    <text fg={active() ? theme.text.action.primary.focused : theme.text.muted} wrapMode="none">
                      {status()}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
      <Show when={selectedEntry()}>
        {(entry) => (
          <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1}>
            <Show when={entry().model}>{(model) => <text fg={theme.text.muted}>{model()}</text>}</Show>
            <SubagentVerdict decision={entry().decision} checkpoint={{ type: "in_scope" }} />
            <text
              id={`subagent-open-${entry().sessionID}`}
              fg={theme.text.action.primary.selected}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() => navigate({ type: "session", sessionID: entry().sessionID })}
            >
              open
            </text>
            <Show when={entry().status === "running"}>
              <text
                id={`subagent-steer-${entry().sessionID}`}
                fg={theme.text.action.primary.base}
                attributes={TextAttributes.UNDERLINE}
                onMouseUp={() => steer(entry())}
              >
                steer
              </text>
              <text
                id={`subagent-kill-${entry().sessionID}`}
                fg={theme.text.action.destructive.base}
                bg={theme.background.action.destructive.base}
                attributes={TextAttributes.UNDERLINE}
                onMouseUp={() => kill(entry())}
              >
                kill
              </text>
            </Show>
          </box>
        )}
      </Show>
    </Show>
  )
}

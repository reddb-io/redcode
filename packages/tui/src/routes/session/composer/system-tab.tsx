import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { SystemInfo } from "@opencode/client"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../../../context/client"
import { Keymap } from "../../../context/keymap"
import { useTheme } from "../../../context/theme"
import { useComposerTab } from "./context"
import { SYSTEM_POLL_MS, systemLines } from "./system-model"

/** The label column: wide enough for the longest label, so the values line up. */
const LABEL_WIDTH = 8

/** What Redcode is: its version and runtime, the database it uses and where its files live. */
export function SystemTab() {
  const composer = useComposerTab()
  const client = useClient()
  const theme = useTheme()
  const shortcuts = Keymap.useShortcuts()
  const [info, setInfo] = createSignal<SystemInfo>()
  const [failure, setFailure] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  let scroll: ScrollBoxRenderable | undefined

  const refresh = () =>
    void client.api.server
      .system()
      .then((value) => {
        setInfo(value)
        setFailure(undefined)
        setNow(Date.now())
      })
      .catch((error: unknown) => setFailure(error instanceof Error ? error.message : "request failed"))

  // Read on opening, and again while it stays open: the process's memory, uptime and the database's size move.
  createEffect(() => {
    if (!composer.active("system")) return
    refresh()
    const timer = setInterval(refresh, SYSTEM_POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  onMount(() => {
    const cleanup = composer.register({
      id: "system",
      label: "System",
      hints: () => [{ label: "refresh", shortcut: shortcuts.get("composer.system.refresh") ?? "" }],
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("system"),
    priority: 1,
    commands: [
      { id: "composer.system.up", title: "Scroll System up", group: "Composer", run: () => scroll?.scrollBy(-1) },
      { id: "composer.system.down", title: "Scroll System down", group: "Composer", run: () => scroll?.scrollBy(1) },
      { id: "composer.system.refresh", title: "Refresh System", group: "Composer", run: refresh },
    ],
  }))

  return (
    <Show when={composer.active("system")}>
      <Show
        when={info()}
        fallback={
          <text fg={failure() ? theme.text.feedback.error.base : theme.text.muted}>
            {failure() ? ` Could not load system information: ${failure()}` : " Loading system information…"}
          </text>
        }
      >
        {(value) => (
          <scrollbox
            scrollbarOptions={{ visible: false }}
            maxHeight={5}
            ref={(element: ScrollBoxRenderable) => (scroll = element)}
          >
            <For each={systemLines(value(), now())}>
              {(line) =>
                "heading" in line ? (
                  <text fg={theme.text.muted} attributes={TextAttributes.BOLD} paddingLeft={1}>
                    {line.heading.toUpperCase()}
                  </text>
                ) : (
                  <box flexDirection="row" paddingLeft={1} gap={1}>
                    <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
                      {line.label.padEnd(LABEL_WIDTH)}
                    </text>
                    <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1}>
                      {line.value}
                    </text>
                  </box>
                )
              }
            </For>
          </scrollbox>
        )}
      </Show>
    </Show>
  )
}

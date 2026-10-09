import { createMemo, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client/promise"
import type { MountedSession } from "@opencode/gui-extensions/sdk"
import { useData } from "@opencode/session-ui/context"
import { sessionOutputCounts, sessionOutputs } from "@opencode/session-ui/timeline/outputs"
import { SessionOutputsCard } from "@opencode/session-ui/timeline/outputs-card"
import { useExtensionHost } from "@/runtime/extension/host"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { useCommand } from "@/shell/commands/command"

// Below this transcript width the card starts collapsed, so its list does not cover the conversation.
const openWidth = 1100

/**
 * The session's Outputs / Subagents / Sources card, anchored at the top-right of the transcript. It starts open where
 * the transcript leaves room beside the conversation and collapsed elsewhere; a toggle holds for the session view.
 */
export function SessionOutputsOverlay(props: {
  messages: Accessor<readonly SessionMessageInfo[]>
  view: MountedSession
  /** Leaves room for the sticky session header above the transcript. */
  header: boolean
}) {
  const data = useData()
  const host = useExtensionHost()
  const platform = usePlatform()
  const server = useServer()
  const command = useCommand()
  const outputs = createMemo(() => sessionOutputs(props.messages()))
  const counts = createMemo(() => sessionOutputCounts(outputs()))
  const visible = () => counts().outputs + counts().subagents + counts().sources > 0
  const [chosen, setChosen] = createSignal<boolean>()
  const [wide, setWide] = createSignal(false)
  const [element, setElement] = createSignal<HTMLDivElement>()

  onMount(() => {
    const container = element()?.parentElement

    if (!container) return

    const observer = new ResizeObserver(() => setWide(container.clientWidth >= openWidth))
    observer.observe(container)
    onCleanup(() => observer.disconnect())
  })

  const openUrl = (url: string) => {
    if (host.links.open({ href: url, origin: "browser", session: props.view })) return
    platform.openExternal(url)
  }

  return (
    <div
      ref={setElement}
      data-component="session-outputs-anchor"
      class="pointer-events-none absolute end-5 z-20 flex max-w-[calc(100%-2.5rem)] flex-col items-end"
      style={{
        top: props.header ? "calc(48px + 12px)" : "12px",
        "max-height": props.header ? "calc(100% - 48px - 96px)" : "calc(100% - 96px)",
      }}
    >
      <Show when={visible()}>
        <SessionOutputsCard
          outputs={outputs()}
          open={chosen() ?? wide()}
          onOpenChange={setChosen}
          liveStatus={(sessionID) => {
            if (server.ctx.data.session.status(sessionID) === "running") return "running"
            if (server.ctx.data.session.get(sessionID)) return "done"
          }}
          onOpenFile={(path) => host.links.open({ href: path, exact: true, session: props.view })}
          onOpenDesign={() => void command.trigger("design.open")}
          onOpenSession={data.navigateToSession}
          onOpenUrl={openUrl}
        />
      </Show>
    </div>
  )
}

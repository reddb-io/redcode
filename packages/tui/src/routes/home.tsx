import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js"
import type { PromptInfo } from "../prompt/history"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useEditorContext } from "../context/editor"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { Keymap } from "../context/keymap"
import { useToast } from "../ui/toast"
import { useLog } from "../context/log"

// Session admission belongs to the App owner, which survives transient Home remounts.
export function createHomeSession(props: { pending: () => boolean; prompt: () => PromptInfo | undefined }) {
  const route = useRoute()
  const data = useData()
  const local = useLocal()
  const location = useLocation()
  const client = useClient()
  const editor = useEditorContext()
  const toast = useToast()
  const log = useLog({ component: "home" })
  const [failed, setFailed] = createSignal(false)
  let started = false
  let active: string | undefined
  onCleanup(() => {
    active = undefined
  })

  function open() {
    if (started || route.data.type !== "home") return
    started = true
    setFailed(false)
    const target = route.data.location ?? data.location.default()
    const prompt = route.data.prompt ?? props.prompt()
    const agent = local.agent.current()
    const model = local.model.selection()
    location.set(target)
    const created = data.session.create({
      location: target,
      agent: agent?.id,
      model: model ? { providerID: model.providerID, id: model.modelID, variant: model.variant } : undefined,
    })
    active = created.id
    log.debug("Opening new session", { sessionID: created.id })
    void created.request
      .then(() => {
        log.debug("New session opened", { sessionID: created.id, active: active === created.id })
        if (active !== created.id || route.data.type !== "home") return
        editor.clearSelection()
        route.navigate({ type: "session", sessionID: created.id, prompt })
      })
      .catch((error) => {
        if (active !== created.id || route.data.type !== "home") return
        active = undefined
        started = false
        setFailed(true)
        toast.error(error)
      })
  }

  createEffect(() => {
    if (route.data.type !== "home") {
      active = undefined
      started = false
      setFailed(false)
      return
    }
    if (props.pending() || client.connection.status() !== "connected") return
    untrack(open)
  })

  return { failed, open }
}

// Home is a transition to a durable blank session, never a welcome/composer screen.
export function Home(props: { failed: boolean; onRetry: () => void }) {
  const theme = useTheme()
  Keymap.createLayer(() => ({
    enabled: () => props.failed,
    commands: [{ bind: "enter", title: "Retry creating session", group: "Session", run: props.onRetry }],
  }))

  return (
    <box flexGrow={1} justifyContent="flex-end" padding={1}>
      <Show when={props.failed} fallback={<text fg={theme.text.muted}>Opening session…</text>}>
        <text fg={theme.text.action.primary.base} onMouseUp={props.onRetry}>
          Could not create session. Press enter or click to retry.
        </text>
      </Show>
    </box>
  )
}

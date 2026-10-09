import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Command, createKeyed, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"
import { createDesignReview } from "./model"
import { latestDesignPreview } from "./state"

const setup: Setup<typeof definition> = (ctx) => {
  const SessionDesignPanel = lazy(() => import("./panel"))
  // Compile the panel while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionDesignPanel.preload()))
  const layout = ctx.layout
  const sessions = ctx.sessions
  const openReview = createDesignReview(ctx)
  const key = `${ctx.id}:main`
  // Changes when a session mounts or unmounts, not on every switch between sessions.
  const mounted = createMemo(() => !!sessions.current())

  const open = () => {
    const session = sessions.current()
    if (session) layout.open(key, session)
  }

  // A preview published while the agent works brings the tab forward once, the way a browser opens a tab; loading an
  // older session's history never does, and closing the tab keeps it closed. Syncs the side strip with server data.
  createKeyed(
    () => sessions.current()?.key,
    () => {
      const state: { last?: string } = {}
      createKeyed(
        () => {
          const session = sessions.current()
          if (!session) return undefined
          return latestDesignPreview(session.server.data.session.message.list(session.id)) ?? "none"
        },
        (preview) => {
          const previous = state.last
          state.last = preview
          if (previous === undefined || previous === preview || preview === "none") return
          const session = sessions.current()
          if (!session || session.server.data.session.status(session.id) === "idle") return
          layout.open(key, session, { background: true })
        },
      )
    },
  )

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      slash: { name: "design-review" },
      // Offered only while a session is open in a desktop-width window.
      enabled: !layout.narrow() && mounted(),
      run: open,
    }),
  )

  // One tab object for every session, so neither strip updates nor a session switch remount its trigger.
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="window-cursor" size="small" />
        <span>{ctx.t("tab.title")}</span>
      </div>
    ),
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    // Layouts saved before extensions store the tab as "design".
    legacy: { design: "main" },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => (
      <Suspense>
        <SessionDesignPanel session={props.session} openReview={openReview} />
      </Suspense>
    ),
  })
}

export default setup

import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Command, createKeyed, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"
import { createDesignReview } from "./model"
import { latestDesignPreview, openDesignReviewPane } from "./state"

const setup: Setup<typeof definition> = (ctx) => {
  const SessionDesignPanel = lazy(() => import("./panel"))
  // Compile the panel while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionDesignPanel.preload()))
  const layout = ctx.layout
  const sessions = ctx.sessions
  const key = `${ctx.id}:main`
  const review = createDesignReview(ctx, { waiting: (session) => layout.open(key, session) })
  // Changes when a session mounts or unmounts, not on every switch between sessions.
  const mounted = createMemo(() => !!sessions.current())

  // One open action everywhere: the review beside the session when the pane can show it, held for the
  // pane while it loads, a system browser when there is no pane.
  const open = () => {
    const session = sessions.current()
    if (session) void review.open(session)
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
          if (!session) return
          // A preview published while the agent works brings the review forward beside its chat; once the
          // agent looks idle, or the pane cannot show it, the new revision still opens its tab, only behind
          // whatever the user is reading. Restored history stays quiet.
          const idle = session.server.data.session.status(session.id) === "idle"
          if (ctx.desktop && !idle && !layout.narrow() && openDesignReviewPane(ctx.uses.browser(), session)) return
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
      <Suspense fallback={<div class="h-full" data-slot="session-design-panel-suspense" />}>
        <SessionDesignPanel session={props.session} review={review} />
      </Suspense>
    ),
  })
}

export default setup

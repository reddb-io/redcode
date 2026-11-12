import { lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { Command, MenuItem, onIdle, Panel, SettingsPage, Slot, usePanel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const Components = lazy(() => import("./components"))
  onCleanup(onIdle(() => void Components.preload()))
  const key = `${ctx.id}:main`
  const open = () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.open(key, session)
  }
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("title")
    },
    closable: "compact",
  }
  ctx.add(Slot, {
    at: "session.header",
    order: 16,
    render: (input) => (
      <Tooltip value={ctx.t("open")}>
        <IconButton
          icon={<Icon name="grid-plus" size="small" />}
          variant="ghost"
          aria-label={ctx.t("open")}
          aria-pressed={ctx.layout.state(key, input.session) === "visible"}
          onClick={() => ctx.layout.toggle(key, input.session)}
        />
      </Tooltip>
    ),
  })
  ctx.add(Panel, {
    id: "main",
    region: "side",
    mobile: { title: ctx.t("title"), order: 16, kind: "drawer", icon: "grid-plus" },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => {
      const panel = usePanel()
      return (
        <Suspense>
          <Components
            server={props.session.server}
            location={props.session.location}
            sessionID={props.session.id}
            visible={panel.visible()}
          />
        </Suspense>
      )
    },
  })
  ctx.add(Command, {
    id: "open",
    title: ctx.t("open"),
    description: ctx.t("command.description"),
    section: "session",
    slash: { name: "creator-components" },
    get enabled() {
      return !!ctx.sessions.current()
    },
    run: open,
  })
  ctx.add(MenuItem, {
    id: "open",
    menu: "session.panel",
    title: ctx.t("title"),
    icon: "grid-plus",
    keybind: `${ctx.id}.open`,
    order: 38,
    run: open,
  })
  ctx.add(SettingsPage, {
    id: "components",
    page: "extensions",
    section: "plugins",
    title: ctx.t("title"),
    entries: [{ id: "components", title: ctx.t("title"), keywords: "creator interactive component install panel" }],
    render: (input) => (
      <Suspense>
        <Components
          server={input.server ? ctx.servers.get(input.server) : undefined}
          location={input.directory ? { directory: input.directory } : undefined}
          visible
        />
      </Suspense>
    ),
  })
}

export default setup

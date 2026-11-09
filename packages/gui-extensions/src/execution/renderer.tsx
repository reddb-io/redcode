import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, MenuItem, onIdle, Panel, Slot, usePanel, type PanelTab, type Setup } from "../sdk"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const ExecutionPanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void ExecutionPanel.preload()))
  const key = `${ctx.id}:main`
  const open = () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.toggle(key, session)
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
    order: 12,
    render: (input) => (
      <Tooltip value={ctx.t("open")}>
        <IconButton
          icon={<Icon name="subagent" size="small" />}
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
    mobile: { title: ctx.t("title"), order: 12, kind: "drawer", icon: "subagent" },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => {
      const panel = usePanel()
      return (
        <Suspense>
          <ExecutionPanel session={props.session} visible={panel.visible()} />
        </Suspense>
      )
    },
  })
  ctx.add(Command, {
    id: "open",
    title: ctx.t("open"),
    description: ctx.t("command.description"),
    section: "session",
    enabled: !!ctx.sessions.current(),
    run: open,
  })
  ctx.add(MenuItem, {
    id: "open",
    menu: "session.panel",
    title: ctx.t("title"),
    icon: "subagent",
    keybind: `${ctx.id}.open`,
    order: 35,
    run: open,
  })
}

export default setup

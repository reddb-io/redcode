import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Command, onIdle, Panel, Slot, usePanel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const DeliveryPanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void DeliveryPanel.preload()))
  ctx.add(Slot, {
    at: "session.header",
    order: 15,
    render: (input) => (
      <Tooltip value={ctx.t("open")}>
        <IconButton
          icon={<Icon name="status" size="small" />}
          variant="ghost"
          aria-label={ctx.t("open")}
          aria-pressed={ctx.layout.state(`${ctx.id}:main`, input.session) === "visible"}
          onClick={() => ctx.layout.toggle(`${ctx.id}:main`, input.session)}
        />
      </Tooltip>
    ),
  })
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("title")
    },
    first: true,
    fallback: true,
    closable: "compact",
  }
  ctx.add(Panel, {
    id: "main",
    region: "side",
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 15,
      kind: "tab",
      icon: "status",
    },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => {
      const frame = usePanel()
      const review = createMemo(() => {
        const service = ctx.uses.changes()
        return service.status === "active" ? service.value : undefined
      })
      return (
        <Suspense>
          <DeliveryPanel
            session={props.session}
            visible={frame.visible()}
            onReview={review() ? () => review()?.open(props.session, { select: true }) : undefined}
          />
        </Suspense>
      )
    },
  })
  ctx.add(Command, {
    id: "open",
    get title() {
      return ctx.t("open")
    },
    section: "session",
    get enabled() {
      return !!ctx.sessions.current()
    },
    run: () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.toggle(`${ctx.id}:main`, session)
    },
  })
}

export default setup

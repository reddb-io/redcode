/** @jsxImportSource react */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"
import { sidebarLayout } from "@reddb-io/design-system/app/recipes"
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@/runtime/react/icon.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedMount } from "@/runtime/react/mount"
import type { SharedSource } from "@/runtime/react/source"
import { NavigationRail, MobileNavigationDock } from "./navigation/rail.react"
import { NavigationSidemenu } from "./navigation/sidemenu.react"
import type { NavigationController } from "./navigation/controller"
import {
  NAVIGATION_MAX_WIDTH,
  NAVIGATION_MIN_WIDTH,
  NAVIGATION_PANEL_ID,
  NAVIGATION_BROWSE_ID,
} from "./navigation/model"
import type { ShellSnapshot } from "./shell"
import "../../../ui/src/components/resize-handle.css"
import "./shell.css"

export function Shell(props: {
  source: SharedSource<ShellSnapshot>
  navigation: NavigationController
  slots: Record<"titlebar" | "agents" | "content" | "bottom" | "notifications", SharedMount>
}) {
  const state = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const view = state.navigation
  const navigation = props.navigation
  const [resizing, setResizing] = useState(false)
  const frame = sidebarLayout({ rail: true, railOpen: !view.mobile, panelOpen: view.opened })
  const dismissPanel = () => {
    navigation.panel.close()
    if (view.mobile) document.getElementById(NAVIGATION_BROWSE_ID)?.focus()
  }
  useEffect(() => {
    // Menus and dialogs consume Escape before this last shell handler.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !view.mobile || !view.opened) return
      navigation.panel.close()
      document.getElementById(NAVIGATION_BROWSE_ID)?.focus()
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [navigation, view.mobile, view.opened])
  const label = view.language.t(view.route.agents ? "agents.title" : "sidebar.nav.projectsAndSessions")
  return (
    <div
      className="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={
        {
          "--shell-inline-inset": view.mobile ? "1px" : "8px",
          "--shell-top-inset": state.bottomTitlebar ? "0px" : state.windows ? "1px" : "8px",
          "--shell-bottom-inset": view.mobile
            ? "8px"
            : "max(0px, calc(8px - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))",
        } as CSSProperties
      }
    >
      <SharedSlot mount={props.slots.titlebar} />
      <div
        data-sidebar-layout
        data-sidebar-layout-mode="rail-panel"
        data-panel-open={view.opened}
        className={frame.root({ class: "min-h-0 flex-1 grid-rows-[minmax(0,1fr)]" })}
        style={{
          minHeight: "0",
          gridTemplateColumns: !view.mobile && view.opened ? `max-content ${view.width}px minmax(0, 1fr)` : undefined,
          transition: resizing ? "none" : undefined,
        }}
      >
        <div
          className={frame.railRegion({ class: "max-md:hidden" })}
          style={{ minHeight: "0" }}
          data-sidebar-layout-region="rail"
        >
          <NavigationRail view={view} navigation={navigation} />
        </div>
        {view.mobile && view.opened && (
          <button
            type="button"
            aria-label={view.language.t("navigation.close")}
            data-sidebar-drawer-backdrop
            className="fixed inset-0 z-30 bg-foreground/20 md:hidden"
            onClick={dismissPanel}
          />
        )}
        <aside
          id={NAVIGATION_PANEL_ID}
          tabIndex={-1}
          aria-label={label}
          data-sidebar-layout-region="sidebar"
          data-mobile-presentation="drawer"
          data-state={view.opened ? "open" : "closed"}
          inert={!view.opened}
          className={frame.panel({
            class: `relative flex min-h-0 flex-col max-md:p-0 max-md:w-[min(20rem,100dvw)] ${!view.opened ? "max-md:invisible md:border-e-0" : ""}`,
          })}
        >
          {view.mobile && (
            <div className="flex shrink-0 items-center justify-between gap-2 p-2">
              <span className="text-13-medium">{label}</span>
              <Button variant="ghost" size="sm" aria-label={view.language.t("navigation.close")} onClick={dismissPanel}>
                <Icon name="close" />
              </Button>
            </div>
          )}
          {view.route.agents ? (
            <SharedSlot mount={props.slots.agents} />
          ) : (
            <NavigationSidemenu view={view} navigation={navigation} />
          )}
          {!view.mobile && view.opened && (
            <PanelResize width={view.width} navigation={navigation} label={label} onResizing={setResizing} />
          )}
        </aside>
        {/* Size containment collapses percentage-height descendants in WebKit. */}
        <main
          className={frame.main({
            class: "min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-content",
          })}
          data-sidebar-layout-region="main"
          style={
            {
              paddingTop: state.bottomTitlebar ? "env(safe-area-inset-top, 0px)" : "0px",
              paddingBottom:
                view.mobile || state.settings
                  ? "0px"
                  : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
              "--settings-bottom-inset": state.bottomTitlebar
                ? "40px"
                : view.mobile
                  ? "0px"
                  : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
            } as CSSProperties
          }
        >
          <SharedSlot mount={props.slots.content} />
        </main>
      </div>
      <SharedSlot mount={props.slots.bottom} />
      {view.mobile && <MobileNavigationDock view={view} navigation={navigation} safeArea={!state.bottomTitlebar} />}
      <SharedSlot mount={props.slots.notifications} />
    </div>
  )
}

function PanelResize(props: {
  width: number
  navigation: NavigationController
  label: string
  onResizing: (value: boolean) => void
}) {
  const drag = useRef<{ x: number; width: number; rtl: boolean; current: number }>(null)
  const resize = (value: number) =>
    props.navigation.panel.resize(Math.min(NAVIGATION_MAX_WIDTH, Math.max(NAVIGATION_MIN_WIDTH, value)))
  useEffect(() => () => props.onResizing(false), [props.onResizing])
  return (
    <div
      data-component="resize-handle"
      data-direction="horizontal"
      data-edge="end"
      className="-end-1"
      role="separator"
      tabIndex={0}
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuenow={props.width}
      aria-valuemin={NAVIGATION_MIN_WIDTH}
      aria-valuemax={NAVIGATION_MAX_WIDTH}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
        resize(
          event.key === "Home"
            ? NAVIGATION_MIN_WIDTH
            : event.key === "End"
              ? NAVIGATION_MAX_WIDTH
              : props.width + ((event.key === "ArrowRight") !== rtl ? 8 : -8),
        )
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.detail > 1) return
        event.preventDefault()
        drag.current = {
          x: event.clientX,
          width: props.width,
          rtl: getComputedStyle(event.currentTarget).direction === "rtl",
          current: props.width,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        props.onResizing(true)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        drag.current.current = drag.current.width + (event.clientX - drag.current.x) * (drag.current.rtl ? -1 : 1)
        resize(drag.current.current)
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        const collapsed = drag.current.current < NAVIGATION_MIN_WIDTH - 60
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        props.onResizing(false)
        if (collapsed) props.navigation.panel.close()
      }}
      onLostPointerCapture={() => {
        drag.current = null
        props.onResizing(false)
      }}
    />
  )
}

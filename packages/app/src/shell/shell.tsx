import { createMemo, lazy, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { sidebarLayout } from "@opencode/ui/contracts/sidebar-layout"
import { Titlebar, type TitlebarUpdate } from "@/shell/titlebar/titlebar"
import { usePlatform } from "@/runtime/platform/platform"
import { ToastRegion } from "@/shell/notifications/toast"
import { UploadToastHost } from "@/composer/attachments/uploads"
import { TitlebarRightProvider } from "@/shell/titlebar/right-slot"
import { useSettingsSurface } from "@/settings/surface"
import { useSettings } from "@/settings/model"
import { SshAuthentication } from "@/servers/ssh/authentication"
import { useUpdaterInstall } from "@/shell/updates/download"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { createNavigationController } from "@/shell/navigation/controller"
import { NavigationRail } from "@/shell/navigation/rail"
import { NavigationSidemenu } from "@/shell/navigation/sidemenu"
import { NAVIGATION_MAX_WIDTH, NAVIGATION_MIN_WIDTH } from "@/shell/navigation/model"

const DebugBar = lazy(() => import("@/shell/debug/debug-bar").then((module) => ({ default: module.DebugBar })))

const NAVIGATION_PANEL_ID = "navigation-sidemenu"
// The rail's own width, as the DS rail layout computes it.
const RAIL_WIDTH = "calc(var(--reddb-spatial-control-height-md) + 2 * var(--reddb-spatial-inset-sm))"

export default function Layout(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettingsSurface()
  const preferences = useSettings()
  const installUpdate = useUpdaterInstall()
  const command = useCommand()
  const language = useLanguage()
  const navigation = createNavigationController()
  const [state, setState] = createStore({ debugTools: false, resizing: false })
  const mobile = navigation.mobile
  const bottomTitlebar = () => mobile() && preferences.general.mobileTitlebarPosition() === "bottom"
  const opened = () => navigation.panel.opened()
  const frame = createMemo(() => sidebarLayout({ rail: true, railOpen: true, panelOpen: opened() }))

  const update: TitlebarUpdate = {
    get state() {
      return platform.updater?.state()
    },
    install: installUpdate,
  }
  // A plain object avoids the compiler's conditional-prop memo, which leaks when read from event handlers.
  const debugTools = {
    get visible() {
      return state.debugTools
    },
    toggle: () => setState("debugTools", (value) => !value),
  }

  command.register("debug-bar", () => [
    {
      id: "debugBar.toggle",
      title: language.t("command.debugBar.toggle"),
      category: language.t("command.category.view"),
      onSelect: debugTools.toggle,
    },
  ])

  // The DS drawer closes on Escape; the window listener runs after dialogs and menus took theirs.
  makeEventListener(window, "keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !mobile() || !opened()) return
    navigation.panel.close()
  })

  return (
    <TitlebarRightProvider>
      <div
        class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
        style={{
          // Native Windows chrome supplies the gap; retain paint clearance for the panels' outer outlines.
          "--shell-top-inset": bottomTitlebar()
            ? "max(0px, calc(8px - env(safe-area-inset-top, 0px)))"
            : platform.platform === "desktop" && platform.os === "windows"
              ? "1px"
              : "8px",
          "--shell-bottom-inset": bottomTitlebar()
            ? "8px"
            : "max(0px, calc(8px - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))",
          "--navigation-rail-width": RAIL_WIDTH,
        }}
      >
        <Titlebar update={update} debugTools={debugTools} />
        <div
          data-sidebar-layout
          data-sidebar-layout-mode="rail-panel"
          data-panel-open={opened()}
          class={frame().root({ class: "min-h-0 flex-1 grid-rows-[minmax(0,1fr)]" })}
          style={{
            // The DS frame is page chrome sized to the viewport; here it fills the space under the titlebar.
            "min-height": "0",
            // The sidemenu keeps the width the user dragged it to rather than the frame's 1 : 3 split.
            "grid-template-columns":
              !mobile() && opened() ? `${RAIL_WIDTH} ${navigation.panel.width()}px minmax(0, 1fr)` : undefined,
            transition: state.resizing ? "none" : undefined,
          }}
        >
          <div class={frame().railRegion()} style={{ "min-height": "0" }} data-sidebar-layout-region="rail">
            <NavigationRail navigation={navigation} panelID={NAVIGATION_PANEL_ID} />
          </div>
          <Show when={mobile() && opened()}>
            <button
              type="button"
              aria-label={language.t("navigation.close")}
              data-sidebar-drawer-backdrop
              class="fixed inset-0 z-30 bg-foreground/20 md:hidden"
              onClick={navigation.panel.close}
            />
          </Show>
          <aside
            id={NAVIGATION_PANEL_ID}
            aria-label={language.t("sidebar.nav.projectsAndSessions")}
            data-sidebar-layout-region="sidebar"
            data-mobile-presentation="drawer"
            data-state={opened() ? "open" : "closed"}
            inert={!opened()}
            class={frame().panel({ class: "relative flex min-h-0 flex-col max-md:p-0" })}
            classList={{ "max-md:invisible md:border-e-0": !opened() }}
          >
            <NavigationSidemenu navigation={navigation} />
            <Show when={!mobile() && opened()}>
              <div
                class="contents"
                onPointerDown={() => {
                  setState("resizing", true)
                  window.addEventListener("pointerup", () => setState("resizing", false), { once: true })
                }}
              >
                <ResizeHandle
                  class="-end-1"
                  direction="horizontal"
                  size={navigation.panel.width()}
                  min={NAVIGATION_MIN_WIDTH}
                  max={NAVIGATION_MAX_WIDTH}
                  collapseThreshold={NAVIGATION_MIN_WIDTH - 60}
                  onCollapse={navigation.panel.close}
                  onResize={navigation.panel.resize}
                />
              </div>
            </Show>
          </aside>
          {/* Size containment collapses percentage-height descendants in WebKit. */}
          <main
            class={frame().main({
              class: "min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-content",
            })}
            data-sidebar-layout-region="main"
            style={{
              "padding-top": bottomTitlebar() ? "env(safe-area-inset-top, 0px)" : "0px",
              "padding-bottom":
                bottomTitlebar() || settings.active()
                  ? "0px"
                  : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
              "--settings-bottom-inset": bottomTitlebar()
                ? "40px"
                : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
              "--settings-top-inset": mobile() && !bottomTitlebar() ? "0px" : "var(--shell-top-inset, 8px)",
            }}
          >
            <SshAuthentication>
              <Suspense>{props.children}</Suspense>
            </SshAuthentication>
          </main>
        </div>
        <Show when={state.debugTools}>
          <Suspense>
            <DebugBar diagnostics={import.meta.env.DEV} inline />
          </Suspense>
        </Show>
        <ToastRegion />
        <UploadToastHost />
      </div>
    </TitlebarRightProvider>
  )
}

import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createSettingsController } from "./controller"
import { createSimpleContext } from "@opencode/ui/context"
import { useLayout, type LayoutRoute } from "@/shell/state/layout"
import { useCommand } from "@/shell/commands/command"
import { createSettingsPages } from "@/runtime/extension/settings-pages"
import { useSettingsServers } from "./servers/inventory"
import { parseSettingsView, settingsViewUrl, type SettingsTransientView, type SettingsView } from "./route"

export type {
  SettingsExtensionTab,
  SettingsHostView,
  SettingsProjectTab,
  SettingsRootTab,
  SettingsServerTab,
  SettingsView,
} from "./route"

export const { use: useSettingsSurface, provider: SettingsSurfaceProvider } = createSimpleContext({
  name: "SettingsSurface",
  gate: false,
  init: () => {
    const navigate = useNavigate()
    const layout = useLayout()
    const command = useCommand()
    const servers = useSettingsServers()

    const location = useLocation<{
      settings?: { route: Exclude<LayoutRoute, { type: "settings" }>; view?: SettingsTransientView }
    }>()

    const extensions = createSettingsPages()
    const open = () => layout.route().type === "settings"
    const source = () => location.state?.settings?.route ?? { type: "home" as const }

    const view = () =>
      parseSettingsView(location.search, servers().length > 1, location.state?.settings?.view, extensions.tabs())

    let focus: HTMLElement | undefined

    const show = (view: SettingsView) => {
      const route = layout.route()

      if (route.type !== "settings" && document.activeElement instanceof HTMLElement) focus = document.activeElement
      navigate(settingsViewUrl(view), {
        replace: route.type === "settings",
        state: {
          settings: {
            route: route.type === "settings" ? source() : route,
            view: { target: view.target, searchActivation: view.searchActivation },
          },
        },
      })
    }

    const controller = createSettingsController({
      view,
      active: open,
      show,
      multiple: () => servers().length > 1,
      extensions: extensions.tabs,
      goBack: () => command.trigger("common.goBack"),
    })
    const [search, setSearch] = createStore({ ...controller.search.state })
    onCleanup(controller.search.source.subscribe(() => setSearch(reconcile(controller.search.state))))

    createEffect(
      on(
        open,
        (value) => {
          if (value) return
          controller.search.clear()
          if (focus?.isConnected) focus.focus({ preventScroll: true })
          focus = undefined
        },
        { defer: true },
      ),
    )

    return {
      active: open,
      route: source,
      view,
      extensions,
      ...controller,
      search: {
        ...controller.search,
        state: search,
      },
    }
  },
})

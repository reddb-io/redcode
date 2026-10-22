import { createMediaQuery } from "@solid-primitives/media"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { sharedSource } from "@/runtime/react/source"
import { useCommand } from "@/shell/commands/command"
import { settingsProjects, useSettingsServers } from "./servers/inventory"
import { useSettingsSurface } from "./surface"
import { settingsSearchIndex } from "./search-index"
import { settingsLanguage } from "./shared.react"

/** Shared application services only; filtering, keyboard and result state belong to React. */
export function createSettingsSearchServices() {
  const language = useLanguage()
  const command = useCommand()
  const platform = usePlatform()
  const global = useGlobal()
  const servers = useSettingsServers()
  const surface = useSettingsSurface()
  const mobile = createMediaQuery("(max-width: 767px)")
  const input = { current: undefined as HTMLInputElement | undefined }
  const snapshot = sharedSource(() => ({
    language: settingsLanguage(language),
    view: surface.view(),
    multiple: servers().length > 1,
    catalog:
      surface.view().type === "root"
        ? settingsSearchIndex({
            servers: servers().map((server) => {
              const context = server.connection ? global.ensureServerCtx(server.connection) : undefined
              return {
                ...server,
                connected: context?.sdk.connection.status() === "connected",
                projects: context
                  ? settingsProjects(context).map((project) => ({ ...project, icon: { ...project.icon } }))
                  : [],
              }
            }),
            desktop: platform.platform === "desktop",
            browser: platform.platform === "web",
            mobile: mobile(),
            translate: language.t,
            extensions: surface.extensions.items(),
          })
        : [],
  }))
  if (surface.view().type === "root")
    command.register("settings.search", () => [
      {
        id: "settings.search.focus",
        title: language.t("settings.search.placeholder"),
        keybind: "mod+f",
        hidden: true,
        onSelect() {
          input.current?.focus({ preventScroll: true })
          input.current?.select()
        },
      },
    ])
  return { snapshot, search: surface.search, input }
}

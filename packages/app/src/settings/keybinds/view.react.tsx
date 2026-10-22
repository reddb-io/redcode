/** @jsxImportSource react */
import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import type { useCommand } from "@/shell/commands/command"
import type { useSettings } from "../model"
import type { SharedSource } from "@/runtime/react/source"
import { SettingsList, type SettingsLanguage } from "../shared.react"
import { SettingsSearchField } from "../search-field.react"
import { SettingsSearchEmpty } from "../search-empty.react"
import { createKeybindSettingsController, groupKey } from "./controller"

type Command = ReturnType<typeof useCommand>
export function KeybindSettings(props: {
  services: {
    snapshot: SharedSource<{
      language: SettingsLanguage
      visible: boolean
      catalog: Command["catalog"]
      options: Command["options"]
      overrides: Record<string, string | undefined>
    }>
    keybinds: Command["keybinds"]
    settings: ReturnType<typeof useSettings>["keybinds"]
    notify: (toast: { title: string; description: string }) => void
  }
}) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const [controller] = useState(() =>
    createKeybindSettingsController(
      {
        command: {
          get catalog() {
            return services.snapshot.getSnapshot().catalog
          },
          get options() {
            return services.snapshot.getSnapshot().options
          },
          keybinds: services.keybinds,
        },
        settings: {
          get current() {
            return { keybinds: services.snapshot.getSnapshot().overrides }
          },
          keybinds: services.settings,
        },
        notify: services.notify,
      },
      {
        locale: () => services.snapshot.getSnapshot().language.locale,
        t: (...args) => services.snapshot.getSnapshot().language.t(...args),
      },
    ),
  )
  useEffect(() => controller.listen(), [controller])
  const capture = useSyncExternalStore(controller.source.subscribe, controller.source.getSnapshot)
  const [filter, setFilter] = useState("")
  const filtered = controller.catalog.filtered(filter)
  const language = state.language
  return (
    <>
      <div className="settings-tab-header settings-tab-header--stacked">
        <div className="settings-tab-header-row">
          <div className="flex flex-col gap-1">
            <h2 className="settings-tab-title">{language.t("settings.shortcuts.title")}</h2>
            <span className="text-11-regular text-ink-muted">{language.t("settings.shortcuts.description")}</span>
          </div>
          <Button variant="ghost" onClick={controller.settings.reset} disabled={!controller.settings.hasOverrides()}>
            {language.t("settings.shortcuts.reset.button")}
          </Button>
        </div>
        <SettingsSearchField
          value={filter}
          active={state.visible}
          onInput={setFilter}
          placeholder={language.t("settings.shortcuts.search.placeholder")}
          language={language}
        />
      </div>
      <div className="settings-tab-body">
        <div className="settings-shortcuts settings-section-stack">
          {controller.catalog.groups.map(
            (group) =>
              (filtered.get(group)?.length ?? 0) > 0 && (
                <div className="settings-section" key={group}>
                  <h3 className="settings-section-title">{language.t(groupKey[group])}</h3>
                  <SettingsList>
                    {(filtered.get(group) ?? []).map((id) => (
                      <div
                        key={id}
                        className="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none"
                      >
                        <span>{controller.catalog.title(id)}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-keybind-id={id}
                          data-expanded={capture.active === id ? "" : undefined}
                          onClick={() => controller.capture.toggle(id)}
                        >
                          {capture.active === id
                            ? language.t("settings.shortcuts.pressKeys")
                            : controller.catalog.keybind(id) || language.t("settings.shortcuts.unassigned")}
                        </Button>
                      </div>
                    ))}
                  </SettingsList>
                </div>
              ),
          )}
          {filter && !controller.catalog.groups.some((group) => (filtered.get(group)?.length ?? 0) > 0) && (
            <div className="settings-tab-search-empty">
              <SettingsSearchEmpty query={filter} language={language} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

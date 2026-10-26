/** @jsxImportSource react */
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { SettingsHeader, SettingsList, SettingsRow, type SettingsLanguage } from "../shared.react"
import { useEffect, useSyncExternalStore } from "react"
import type { ColorScheme } from "@opencode/ui/theme/context"
import type { SharedSource } from "@/runtime/react/source"
import {
  sansInput,
  sansFontFamily,
  sansDefault,
  monoInput,
  monoFontFamily,
  monoDefault,
  terminalInput,
  terminalFontFamily,
  terminalDefault,
  type AppearanceDensity,
} from "../model-data"

const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
  },
  code: {
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
  },
} as const

export function Appearance(props: {
  language: SettingsLanguage
  scheme: ColorScheme
  onSchemeChange: (value: ColorScheme) => void
  themes: { value: string; label: string }[]
  theme: string
  onThemeChange: (id: string) => void
  density: AppearanceDensity
  onDensityChange: (value: AppearanceDensity) => void
  fonts: {
    kind: keyof typeof fontSettings
    value: string
    family: string
    placeholder: string
    onChange: (value: string) => void
  }[]
}) {
  return (
    <>
      <SettingsHeader
        title={props.language.t("settings.general.section.appearance")}
        description={props.language.t("settings.appearance.description")}
      />
      <div className="settings-tab-body">
        <div className="settings-section">
          <SettingsList>
            <SettingsRow
              title={props.language.t("settings.general.row.colorScheme.title")}
              description={props.language.t("settings.general.row.colorScheme.description")}
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-color-scheme"
                  controlSize="sm"
                  value={props.scheme}
                  options={(["system", "light", "dark"] as const).map((value) => ({
                    value,
                    label: props.language.t(`theme.scheme.${value}`),
                  }))}
                  onValueChange={(value) => {
                    if (value === "system" || value === "light" || value === "dark") props.onSchemeChange(value)
                  }}
                />
              )}
            </SettingsRow>
            <SettingsRow
              title={props.language.t("settings.general.row.theme.title")}
              description={
                <>
                  {props.language.t("settings.general.row.theme.description")}{" "}
                  <a
                    className="settings-link"
                    href="https://github.com/reddb-io/redcode"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {props.language.t("common.learnMore")}
                  </a>
                </>
              }
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-theme"
                  controlSize="sm"
                  options={props.themes}
                  value={props.theme}
                  onValueChange={props.onThemeChange}
                />
              )}
            </SettingsRow>
            <SettingsRow
              title={props.language.t("settings.appearance.density.title")}
              description={props.language.t("settings.appearance.density.description")}
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-density"
                  controlSize="sm"
                  value={props.density}
                  options={(["tiny", "compact", "comfortable"] as const).map((value) => ({
                    value,
                    label: props.language.t(`settings.appearance.density.${value}`),
                  }))}
                  onValueChange={(value) => {
                    if (value === "tiny" || value === "compact" || value === "comfortable") props.onDensityChange(value)
                  }}
                />
              )}
            </SettingsRow>
            {props.fonts.map((font) => (
              <SettingsRow
                key={font.kind}
                title={props.language.t(fontSettings[font.kind].title)}
                description={props.language.t(fontSettings[font.kind].description)}
              >
                {(association) => (
                  <div className="w-full sm:w-[220px]">
                    <Input
                      {...association}
                      data-action={fontSettings[font.kind].action}
                      controlSize="sm"
                      type="text"
                      value={font.value}
                      onValueChange={font.onChange}
                      placeholder={font.placeholder}
                      spellCheck={false}
                      autoCorrect="off"
                      autoComplete="off"
                      autoCapitalize="off"
                      style={{ fontFamily: font.family }}
                    />
                  </div>
                )}
              </SettingsRow>
            ))}
          </SettingsList>
        </div>
      </div>
    </>
  )
}

export function AppearanceSettings(props: {
  services: {
    snapshot: SharedSource<{
      language: SettingsLanguage
      scheme: ColorScheme
      theme: string
      density: AppearanceDensity
      themes: { value: string; label: string }[]
      fonts: Record<"ui" | "code" | "terminal", string>
    }>
    loadThemes: () => Promise<unknown>
    setScheme: (value: ColorScheme) => void
    setTheme: (id: string) => void
    setDensity: (value: AppearanceDensity) => void
    fonts: Record<"ui" | "code" | "terminal", (value: string) => void>
  }
}) {
  const state = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  useEffect(() => {
    void props.services.loadThemes()
  }, [props.services])
  return (
    <Appearance
      language={state.language}
      scheme={state.scheme}
      onSchemeChange={props.services.setScheme}
      themes={state.themes}
      theme={state.theme}
      onThemeChange={props.services.setTheme}
      density={state.density}
      onDensityChange={props.services.setDensity}
      fonts={(
        [
          {
            kind: "ui",
            value: sansInput(state.fonts.ui),
            family: sansFontFamily(state.fonts.ui),
            placeholder: sansDefault,
          },
          {
            kind: "code",
            value: monoInput(state.fonts.code),
            family: monoFontFamily(state.fonts.code),
            placeholder: monoDefault,
          },
          {
            kind: "terminal",
            value: terminalInput(state.fonts.terminal),
            family: terminalFontFamily(state.fonts.terminal),
            placeholder: terminalDefault,
          },
        ] as const
      ).map((font) => ({ ...font, onChange: props.services.fonts[font.kind] }))}
    />
  )
}

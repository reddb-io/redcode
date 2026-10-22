/** @jsxImportSource react */
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { SettingsHeader, SettingsList, SettingsRow, type SettingsLanguage } from "../shared.react"
import type { AppearanceSettingsController } from "../general/controllers"

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
  scheme: ReturnType<AppearanceSettingsController["scheme"]["current"]>
  onSchemeChange: AppearanceSettingsController["scheme"]["select"]
  themes: { value: string; label: string }[]
  theme: string
  onThemeChange: (id: string) => void
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

import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { createAppearanceSettingsController } from "../general/controllers"
import { settingsLanguage } from "../shared.react"
import { Appearance } from "./view.react"
import "../settings.css"

export function SettingsAppearance() {
  const language = useLanguage()
  const appearance = createAppearanceSettingsController()

  return (
    <ReactView
      component={Appearance}
      props={{
        language: settingsLanguage(language),
        scheme: appearance.scheme.current(),
        onSchemeChange: appearance.scheme.select,
        themes: appearance.theme.options().map((option) => ({ value: option.id, label: option.name })),
        theme: appearance.theme.current()?.id ?? "",
        onThemeChange: (id) => appearance.theme.select({ id }),
        fonts: (["ui", "code", "terminal"] as const).map((kind) => ({
          kind,
          ...appearance.fonts[kind](),
          onChange:
            kind === "ui"
              ? appearance.fonts.setUI
              : kind === "code"
                ? appearance.fonts.setCode
                : appearance.fonts.setTerminal,
        })),
      }}
    />
  )
}

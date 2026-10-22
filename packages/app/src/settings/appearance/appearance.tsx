import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { useTheme } from "@opencode/ui/theme/context"
import { useSettings } from "../model"
import { settingsLanguage } from "../shared.react"
import { AppearanceSettings } from "./view.react"

export function SettingsAppearance() {
  const language = useLanguage()
  const settings = useSettings()
  const theme = useTheme()
  const services = {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      scheme: theme.colorScheme(),
      theme: theme.themeId(),
      themes: theme.ids().map((id) => ({ value: id, label: theme.name(id) })),
      fonts: {
        ui: settings.appearance.uiFont(),
        code: settings.appearance.font(),
        terminal: settings.appearance.terminalFont(),
      },
    })),
    loadThemes: () => theme.loadThemes(),
    setScheme: theme.setColorScheme,
    setTheme: theme.setTheme,
    fonts: {
      ui: settings.appearance.setUIFont,
      code: settings.appearance.setFont,
      terminal: settings.appearance.setTerminalFont,
    },
  }
  return <ReactView component={AppearanceSettings} props={{ services }} />
}

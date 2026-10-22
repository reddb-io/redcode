import { useCommand } from "@/shell/commands/command"
import { useSettings } from "../model"
import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { showToast } from "@/shell/notifications/toast"
import { settingsLanguage } from "../shared.react"
import { KeybindSettings } from "./view.react"

export function SettingsKeybinds(props: { active?: boolean }) {
  const command = useCommand()
  const settings = useSettings()
  const language = useLanguage()
  const services = {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      visible: props.active ?? true,
      catalog: command.catalog.map((item) => ({ ...item })),
      options: command.options.map((item) => ({ ...item })),
      overrides: { ...settings.current.keybinds },
    })),
    keybinds: command.keybinds,
    settings: settings.keybinds,
    notify: (toast: { title: string; description: string }) => showToast(toast),
  }
  return <ReactView component={KeybindSettings} props={{ services }} />
}

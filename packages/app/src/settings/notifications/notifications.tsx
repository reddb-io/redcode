import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { useSettings } from "../model"
import { createSoundSettingsController, soundOptions } from "../general/controllers"
import { settingsLanguage } from "../shared.react"
import { Notifications } from "./view.react"
import "../settings.css"

export function SettingsNotifications() {
  const language = useLanguage()
  const settings = useSettings()
  const sounds = createSoundSettingsController()
  const actions = {
    agent: settings.notifications.setAgent,
    permissions: settings.notifications.setPermissions,
    errors: settings.notifications.setErrors,
  }

  return (
    <ReactView
      component={Notifications}
      props={{
        language: settingsLanguage(language),
        channels: (["agent", "permissions", "errors"] as const).map((kind) => ({
          kind,
          checked: settings.notifications[kind](),
          onChange: actions[kind],
          sound: sounds[kind].current().id,
          onSoundChange: (value: string) =>
            sounds[kind].select(soundOptions.find((option) => option.id === value) ?? null),
        })),
        sounds: soundOptions.map((option) => ({ value: option.id, label: language.t(option.label) })),
      }}
    />
  )
}

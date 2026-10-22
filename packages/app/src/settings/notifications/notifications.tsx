import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { useSettings } from "../model"
import { settingsLanguage } from "../shared.react"
import { NotificationSettings } from "./view.react"

export function SettingsNotifications() {
  const language = useLanguage()
  const settings = useSettings()
  const channels = ["agent", "permissions", "errors"] as const
  const services = {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      channels: channels.map((kind) => ({
        kind,
        checked: settings.notifications[kind](),
        sound: settings.sounds[kind](),
        enabled: settings.sounds[`${kind}Enabled`](),
      })),
    })),
    actions: {
      agent: {
        notify: settings.notifications.setAgent,
        enable: settings.sounds.setAgentEnabled,
        sound: settings.sounds.setAgent,
      },
      permissions: {
        notify: settings.notifications.setPermissions,
        enable: settings.sounds.setPermissionsEnabled,
        sound: settings.sounds.setPermissions,
      },
      errors: {
        notify: settings.notifications.setErrors,
        enable: settings.sounds.setErrorsEnabled,
        sound: settings.sounds.setErrors,
      },
    },
  }
  return <ReactView component={NotificationSettings} props={{ services }} />
}

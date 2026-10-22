import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ReactView } from "@/runtime/react/view"
import { showToast } from "@/shell/notifications/toast"
import { settingsLanguage } from "../shared.react"
import { About } from "./view.react"

export function SettingsAbout() {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <ReactView
      component={About}
      props={{
        language: settingsLanguage(language),
        version: platform.version,
        onNoticesFailure: () => showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") }),
      }}
    />
  )
}

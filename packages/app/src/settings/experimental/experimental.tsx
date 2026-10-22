import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { SettingsHeader } from "../shared.react"

export const experimentalSettingsAvailable = false
export function SettingsExperimental() {
  const language = useLanguage()
  return (
    <ReactView
      component={SettingsHeader}
      props={{
        title: language.t("settings.tab.experimental"),
        description: language.t("settings.experimental.description"),
      }}
    />
  )
}

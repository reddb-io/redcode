import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import type { SharedSource } from "@/runtime/react/source"
import type { SettingsLanguage } from "../shared.react"
import { sharedSource } from "@/runtime/react/source"
import { settingsLanguage } from "../shared.react"
import { Reporting } from "./view.react"

export function createReportingServices(): SharedSource<{
  language: SettingsLanguage
  api: ReturnType<typeof useServer>["ctx"]["sdk"]["api"]["usageReporter"]
}> {
  const language = useLanguage()
  const server = useServer()
  return sharedSource(() => ({ language: settingsLanguage(language), api: server.ctx.sdk.api.usageReporter }))
}

export function SettingsReporting() {
  const source = createReportingServices()
  return <ReactView component={Reporting} props={{ source }} />
}

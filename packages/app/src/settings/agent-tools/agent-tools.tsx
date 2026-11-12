import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import type { SharedSource } from "@/runtime/react/source"
import type { SettingsLanguage } from "../shared.react"
import { sharedSource } from "@/runtime/react/source"
import { settingsLanguage } from "../shared.react"

export function createAgentToolsServices(): SharedSource<{
  language: SettingsLanguage
  connected: boolean
  api: ReturnType<typeof useServerSDK>["api"]
}> {
  const sdk = useServerSDK()
  const language = useLanguage()
  return sharedSource(() => ({
    language: settingsLanguage(language),
    connected: sdk.connection.status() === "connected",
    api: sdk.api,
  }))
}

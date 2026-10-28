import type { IntelligenceStatus } from "@opencode/client"
import { useModels } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useIntelligenceSettings } from "@/runtime/server/intelligence"
import { showToast } from "@/shell/notifications/toast"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { settingsLanguage, type SettingsLanguage } from "../shared.react"

export type ReasoningServices = {
  snapshot: SharedSource<{
    language: SettingsLanguage
    api: ReturnType<typeof useServerSDK>["api"]
    current?: IntelligenceStatus
    error: boolean
    models: { key: string; ref: { providerID: string; id: string }; label: string }[]
  }>
  refetch: () => Promise<void>
  notify: (toast: Parameters<typeof showToast>[0]) => void
}
export function createReasoningServices(): ReasoningServices {
  const language = useLanguage()
  const models = useModels()
  const server = useServerSDK()
  const status = useIntelligenceSettings()
  const snapshot: SharedSource<{
    language: SettingsLanguage
    api: ReturnType<typeof useServerSDK>["api"]
    current?: IntelligenceStatus
    error: boolean
    models: { key: string; ref: { providerID: string; id: string }; label: string }[]
  }> = sharedSource(() => ({
    language: settingsLanguage(language),
    api: server.api,
    current: status.status(),
    error: !!status.error(),
    models: models
      .list()
      .filter((model) => !/(^|\/)jev(?:$|[-.])/i.test(model.id))
      .map((model) => ({
        key: `${model.provider.id}/${model.id}`,
        ref: { providerID: model.provider.id, id: model.id },
        label: `${model.provider.name} · ${model.name}`,
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label)),
  }))
  return {
    snapshot,
    async refetch() {
      await status.refetch()
    },
    notify: (toast: Parameters<typeof showToast>[0]) => showToast(toast),
  }
}

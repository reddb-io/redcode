import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useLanguage } from "@/runtime/i18n/language"
import { useModels } from "@/providers/models/models"
import { useServerSDK } from "@/runtime/server/client"
import { ReactView } from "@/runtime/react/view"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { settingsLanguage, type SettingsLanguage } from "../shared.react"
import { createReasoningServices } from "./reasoning"
import { Models } from "./view.react"

export const ModelProvidersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})
export type SettingsModel = {
  id: string
  name: string
  provider: { id: string; canonical?: string; integrationID?: string; name: string }
  cost?: { input: number }
  visible: boolean
}
export function createModelsServices(props: { active?: boolean; provider?: string; onReveal?: () => void }) {
  const language = useLanguage()
  const models = useModels()
  const sdk = useServerSDK()
  const [store, setStore] = persisted(
    Persist.serverGlobal(sdk.scope, "settings-v2.models.providers"),
    ModelProvidersSchema,
    { collapsed: {} },
  )
  const snapshot: SharedSource<{
    language: SettingsLanguage
    models: SettingsModel[]
    collapsed: Record<string, boolean>
    active: boolean
    provider?: string
  }> = sharedSource(() => ({
    language: settingsLanguage(language),
    models: models.list().map((item) => ({
      id: item.id,
      name: item.name,
      provider: { ...item.provider },
      cost: item.cost ? { input: item.cost.input } : undefined,
      visible: models.visible({ providerID: item.provider.id, modelID: item.id }),
    })),
    collapsed: { ...store.collapsed },
    active: props.active ?? true,
    provider: props.provider,
  }))
  return {
    snapshot,
    reasoning: createReasoningServices(),
    expand: (key: string, value: boolean) => setStore("collapsed", key, !value),
    visible: (providerID: string, modelID: string, value: boolean) =>
      models.setVisibility({ providerID, modelID }, value),
    reveal: () => props.onReveal?.(),
  }
}
export function SettingsModels(props: { active?: boolean; provider?: string; onReveal?: () => void }) {
  const services = createModelsServices(props)
  return <ReactView component={Models} props={{ services }} />
}

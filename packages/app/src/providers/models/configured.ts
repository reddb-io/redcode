import { createEffect, createMemo, on } from "solid-js"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { useIntelligenceSettings } from "@/runtime/server/intelligence"

export function useConfiguredModel() {
  const data = useData()
  const location = useWorkspaceLocation()
  const server = useServerSDK()
  const intelligence = useIntelligenceSettings()
  createEffect(
    on(
      () => [location().directory, server.connection.status()] as const,
      ([directory]) => {
        void data.location.config.sync({ directory }).catch(() => undefined)
      },
    ),
  )
  const documents = () => data.location.config.list({ directory: location().directory })

  const principal = createMemo(() => {
    const settings = intelligence.status()?.settings
    const model = settings?.enabled ? settings.principal : undefined
    return model
      ? { providerID: model.providerID, modelID: model.id, variant: model.variant, connection: model.connection }
      : undefined
  })
  const model = createMemo(() => {
    if (principal()) return principal()
    const entry = documents()?.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
    const model = entry?.type === "document" ? entry.info.model : undefined

    if (!model) return

    if (typeof model !== "string") return { providerID: model.providerID, modelID: model.model, variant: model.variant }
    const [providerID, ...parts] = model.split("/")

    return { providerID, modelID: parts.join("/"), variant: undefined }
  })

  return Object.assign(model, { principal, ready: () => documents() !== undefined && intelligence.ready() })
}

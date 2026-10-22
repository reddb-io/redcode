import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useProviders } from "@/providers/catalog/providers"
import { useIntegrations } from "@/providers/catalog/integrations"
import { DialogConnectProvider, useProviderConnectController } from "@/providers/connect/dialog"
import { DialogManageIntegration } from "@/providers/connect/manage"
import { showToast } from "@/shell/notifications/toast"
import { ReactView } from "@/runtime/react/view"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { settingsLanguage, type SettingsLanguage } from "../shared.react"
import { Providers } from "./view.react"

export type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number] & { paid: boolean }
export type ProviderSettingsServices = {
  snapshot: SharedSource<{
    language: SettingsLanguage
    directory?: string
    api: ReturnType<typeof useServerSDK>["api"]
    providers: ProviderItem[]
    integrations: ReturnType<ReturnType<typeof useIntegrations>["list"]>
    roles: Record<string, string | undefined>
    selected?: string
  }>
  connect: (provider: string | undefined, connected: (id: string) => void, closed: () => void) => void
  manage: (integrationID: string, name: string, add: () => void) => void
  refresh: () => Promise<void>
  notify: (toast: Parameters<typeof showToast>[0]) => void
  select: (id: string) => void
}
export function createProviderSettingsServices(props: {
  directory: string | undefined
  onSelectProvider?: (providerID: string) => void
}): ProviderSettingsServices {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const providers = useProviders(() => props.directory)
  const integrations = useIntegrations(() => props.directory)
  const controller = useProviderConnectController()
  const snapshot: ProviderSettingsServices["snapshot"] = sharedSource(() => ({
    language: settingsLanguage(language),
    directory: props.directory,
    api: sdk.api,
    providers: providers.connected().map((item) => ({
      ...item,
      models: { ...item.models },
      paid: Object.values(item.models).some((model) => model.cost.input > 0),
    })),
    integrations: integrations
      .list()
      .map((item) => ({ ...item, connections: item.connections.map((connection) => ({ ...connection })) })),
    roles: Object.fromEntries(
      (data.location.provider.list(props.directory ? { directory: props.directory } : undefined) ?? []).map((item) => [
        item.id,
        item.router?.role,
      ]),
    ),
    selected: controller.selected(),
  }))
  const refresh = async () => {
    const location = props.directory ? { directory: props.directory } : undefined
    data.location.integration.invalidate(location)
    data.location.provider.invalidate(location)
    data.location.model.invalidate(location)
    await Promise.all([
      data.location.integration.sync(location),
      data.location.provider.sync(location),
      data.location.model.sync(location),
    ])
  }
  return {
    snapshot,
    refresh,
    connect(provider, connected, closed) {
      controller.select(provider, { add: provider !== undefined })
      void dialog.show(
        () => (
          <DialogConnectProvider
            directory={props.directory}
            defaultLocation={props.directory === undefined}
            controller={controller}
            onConnected={connected}
          />
        ),
        () => {
          closed()
          void refresh().catch(() => undefined)
        },
      )
    },
    manage: (integrationID, name, add) =>
      void dialog.show(() => (
        <DialogManageIntegration integrationID={integrationID} name={name} directory={props.directory} onAdd={add} />
      )),
    notify: (toast) => showToast(toast),
    select: (id) => props.onSelectProvider?.(id),
  }
}
export function SettingsProviders(props: {
  directory: string | undefined
  onSelectProvider?: (providerID: string) => void
}) {
  const services = createProviderSettingsServices(props)
  return <ReactView component={Providers} props={{ services }} />
}

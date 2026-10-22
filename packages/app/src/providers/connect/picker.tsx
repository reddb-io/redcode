import { ModelPresentation } from "@opencode/schema/model-presentation"
import { useData } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { useIntegrations } from "@/providers/catalog/integrations"
import { ProviderPickerView } from "./picker.react"

export function createProviderPickerServices(props: {
  directory?: string
  onSelect: (provider: string) => void
  onPrepare?: () => void
}) {
  const integrations = useIntegrations(() => props.directory)
  const data = useData()
  const language = useLanguage()
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      items: integrations.list().map((integration) => ({
        ...integration,
        metadata: { ...integration.metadata },
        methods: integration.methods.map((method) => ({ ...method })),
        connections: integration.connections.map((connection) => ({ ...connection })),
        role: ModelPresentation.integrationRouterProvider(
          data.location.provider.list(props.directory ? { directory: props.directory } : undefined) ?? [],
          integration.id,
        )?.router?.role,
      })),
    })),
    select: (provider: string) => {
      props.onPrepare?.()
      props.onSelect(provider)
    },
  }
}

export function ProviderPicker(props: Parameters<typeof createProviderPickerServices>[0]) {
  const services = createProviderPickerServices(props)
  return <ReactView component={ProviderPickerView} props={{ services }} />
}

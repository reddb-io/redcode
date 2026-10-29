import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { IntegrationConnectionsView, ManageIntegrationDialog } from "./manage.react"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { IntegrationConnections } from "@opencode/util/integration-connections"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"
import { useIntegrations } from "@/providers/catalog/integrations"
import { connectedProviderID } from "@/providers/catalog/connect-order"
import { showToast } from "@/shell/notifications/toast"

/**
 * One integration's saved connections, as the TUI manages them: switch the active account, rename or
 * delete a connection, add another account or endpoint, and test the active one against the remote API.
 */
export function createIntegrationConnectionsServices(props: {
  integrationID: string
  directory?: string
  /** Shows the integration's icon and name above the list, for hosts without their own title. */
  heading?: boolean
  onAdd: () => void
  onPickModel?: (provider: string) => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const integrations = useIntegrations(() => props.directory)
  const location = () => (props.directory ? { directory: props.directory } : undefined)

  const [state, setState] = createStore<{
    busy?: string
    renaming?: string
    label: string
    deleting?: string
    checking: boolean
    report?: ConnectionCheck.Report
    refreshing: boolean
  }>({ label: "", checking: false, refreshing: false })

  const integration = createMemo(() => integrations.list().find((item) => item.id === props.integrationID))
  const connections = createMemo(() => {
    const value = integration()

    return value ? IntegrationConnections.credentialConnections(value) : []
  })
  const methods = createMemo(() => {
    const value = integration()

    return value ? IntegrationConnections.connectMethods(value) : []
  })
  const name = () => integration()?.name ?? props.integrationID
  const catalogProvider = createMemo(() =>
    (data.location.provider.list(location()) ?? []).find(
      (provider) => (provider.integrationID ?? provider.id) === props.integrationID && provider.catalog,
    ),
  )

  // A RedRouter connection says what its key may do; the saved router connection describes the active key.
  const keyRole = () => {
    const role = ModelPresentation.integrationRouterProvider(
      data.location.provider.list(location()) ?? [],
      props.integrationID,
    )?.router?.role

    if (role === "admin") return language.t("settings.providers.tag.adminKey")

    if (role === "standard") return language.t("settings.providers.tag.standardKey")

    return undefined
  }

  const refresh = () => {
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)

    return Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
  }

  const fail = (error: unknown) =>
    showToast({ title: language.t("common.requestFailed"), description: formatServerError(error, language.t) })

  const activate = (credentialID: string, label: string) => {
    if (state.busy || connections()[0]?.id === credentialID) return
    setState({ busy: credentialID, report: undefined })
    void sdk.api.credential
      .activate({ credentialID })
      .then(refresh)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.providers.account.switched.title", { provider: name() }),
          description: language.t("settings.providers.account.switched.description", { account: label }),
        }),
      )
      .catch(fail)
      .finally(() => setState("busy", undefined))
  }

  const rename = (credentialID: string) => {
    const label = state.label.trim()

    if (!label) return
    setState("busy", credentialID)
    void sdk.api.credential
      .update({ credentialID, label })
      .then(refresh)
      .then(() => setState("renaming", undefined))
      .catch(fail)
      .finally(() => setState("busy", undefined))
  }

  // Deleting asks twice, so one stray click never drops a saved key.
  const remove = (credentialID: string) => {
    if (state.deleting !== credentialID) {
      setState("deleting", credentialID)

      return
    }

    const final = connections().length === 1
    setState({ busy: credentialID, deleting: undefined })
    void sdk.api.credential
      .remove({ credentialID })
      .then(refresh)
      .then(() => {
        if (!final) return
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name() }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name() }),
        })
      })
      .catch(fail)
      .finally(() => setState("busy", undefined))
  }

  const check = async () => {
    if (state.checking) return
    setState({ checking: true, report: undefined })
    const report = await sdk.api.integration.check({ integrationID: props.integrationID, location: location() }).catch(
      (error: unknown): ConnectionCheck.Report => ({
        ok: false,
        message: formatServerError(error, language.t),
        requests: ConnectionCheck.requestsFrom(error),
      }),
    )
    setState({ checking: false, report })
  }

  const pickModel = () => {
    const provider = connectedProviderID(
      data.location.provider.list(location()) ?? [],
      data.location.model.list(location()) ?? [],
      props.integrationID,
    )

    props.onPickModel?.(provider ?? props.integrationID)
  }

  const refreshModels = async () => {
    const provider = catalogProvider()
    if (!provider || state.refreshing) return
    setState("refreshing", true)
    await sdk.api.provider
      .refresh({ providerID: provider.id, location: location() })
      .catch(fail)
      .finally(async () => {
        await refresh().catch(fail)
        setState("refreshing", false)
      })
  }

  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      integrationID: props.integrationID,
      name: name(),
      heading: props.heading,
      connections: connections().map((connection) => ({ ...connection })),
      canAdd: methods().length > 0,
      canCheck: integration()?.metadata?.source !== "mcp",
      canPick: !!props.onPickModel,
      keyRole: keyRole(),
      catalog: catalogProvider()?.catalog,
      modelCount: (data.location.model.list(location()) ?? []).filter(
        (model) => model.providerID === catalogProvider()?.id,
      ).length,
      state: { ...state },
    })),
    update: (patch: Partial<typeof state>) => setState(patch),
    activate,
    rename,
    remove,
    check: () => void check(),
    refreshModels: () => void refreshModels(),
    pickModel,
    add: () => props.onAdd(),
  }
}

export function IntegrationConnectionsPane(props: Parameters<typeof createIntegrationConnectionsServices>[0]) {
  const services = createIntegrationConnectionsServices(props)
  return <ReactView component={IntegrationConnectionsView} props={{ services }} />
}

/** Settings opens the same saved-connection controls used by provider sign-in. */
export function DialogManageIntegration(props: {
  integrationID: string
  name: string
  directory?: string
  onAdd: () => void
}) {
  const language = useLanguage()
  const modal = useNativeDialog()
  const services = createIntegrationConnectionsServices(props)
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    title: language.t("provider.manage.title", { provider: props.name }),
  }))
  return <ReactView component={ManageIntegrationDialog} props={{ source, services, close: modal.close }} />
}

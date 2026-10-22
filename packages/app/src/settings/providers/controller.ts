import { ProviderRemoval } from "@opencode/schema/provider-removal"
import { IntegrationConnections } from "@opencode/util/integration-connections"
import { IntegrationOrder } from "@opencode/util/integration-order"
import { consoleProviderGroup } from "@/providers/catalog/console"
import { CONSOLE_INTEGRATION, CONSOLE_PROVIDERS } from "@/providers/connect/controller"
import { activeProviderAccount, providerAccounts, type ProviderAccount } from "./accounts"
import { settingsState } from "../state"
import type { ProviderItem, ProviderSettingsServices } from "./providers"

type ProviderSource = "env" | "api" | "account" | "config" | "custom"

const PROVIDER_NOTES = [
  { match: (id: string) => id === "red-router", key: "dialog.provider.redRouter.note" },
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
  { match: (id: string) => id === "openai-compatible", key: "dialog.provider.custom.description" },
] as const

export function createProviderSettingsController(services: ProviderSettingsServices) {
  const language = () => services.snapshot.getSnapshot().language
  const state = settingsState({
    disconnecting: {} as Record<string, "removing" | "removed" | "absent" | undefined>,
    consoleExpanded: false,
    connecting: false,
    credentialID: undefined as string | undefined,
    removal: undefined as { item: ProviderItem; name: string; preview: ProviderRemoval.Result } | undefined,
  })
  const updateDisconnecting = (ids: string[], status: "removing" | "removed" | "absent" | undefined) =>
    state.update({
      disconnecting: { ...state.getSnapshot().disconnecting, ...Object.fromEntries(ids.map((id) => [id, status])) },
    })
  const connect = (provider?: string) => {
    state.update({ connecting: true })
    services.connect(
      provider,
      (id) => {
        if (CONSOLE_PROVIDERS.has(id)) {
          state.update({ disconnecting: {} })
          return
        }
        updateDisconnecting([id], undefined)
      },
      () => state.update({ connecting: false }),
    )
  }
  const manage = (item: ProviderItem, name: string) =>
    services.manage(item.integrationID ?? item.id, name, () => connect(item.integrationID ?? item.id))
  const integration = (item: ProviderItem) => {
    const id = item.integrationID ?? item.id

    return services.snapshot.getSnapshot().integrations.find((entry) => entry.id === id)
  }

  const available = () => {
    const connected = services.snapshot.getSnapshot().providers
    const managedConsole = consoleProviderGroup(connected)

    const consoleConnected = services.snapshot
      .getSnapshot()
      .integrations.find((item) => item.id === CONSOLE_INTEGRATION)
      ?.connections.some((connection) => connection.type === "credential" || connection.type === "env")

    // Hides the free `opencode` row while a new Console grant is still loading its workspace providers.
    const consoleTransition =
      state.getSnapshot().connecting &&
      CONSOLE_PROVIDERS.has(services.snapshot.getSnapshot().selected ?? "") &&
      consoleConnected &&
      managedConsole === undefined

    return connected
      .filter(
        (provider) =>
          provider.id !== "opencode" ||
          (!consoleTransition && (managedConsole !== undefined || consoleConnected || provider.paid)),
      )
      .toSorted((a, b) => Number(b.id === "opencode-go") - Number(a.id === "opencode-go"))
  }

  const connected = () => available().filter((item) => !state.getSnapshot().disconnecting[item.id])

  const consoleGroup = () => consoleProviderGroup(available())

  const displayed = () => {
    const group = consoleGroup()

    if (!group) return connected()
    const grouped = new Set(group.providers.filter((item) => item.id !== group.root.id).map((item) => item.id))

    return connected().filter((item) => !grouped.has(item.id))
  }

  // The popular providers of the connect list, in its order (RedRouter and 9router first).
  const popular = () => {
    const connectedIDs = new Set(connected().map((p) => p.id))

    return services.snapshot
      .getSnapshot()
      .integrations.filter((integration) => IntegrationOrder.providerRank(integration.id) < 99)
      .filter((integration) => {
        // The Console account (integration `opencode`) shares its id with the Zen provider. A stored API
        // key, including one imported from a v1 auth.json, makes Zen "connected" without any account, so
        // the Popular list keeps the sign-in row until the active credential is an OAuth grant.
        if (integration.id === CONSOLE_INTEGRATION)
          return IntegrationConnections.credentialConnections(integration)[0]?.method !== "oauth"

        return !connectedIDs.has(integration.id) && integration.connections.length === 0
      })
      .toSorted(IntegrationOrder.compare)
  }

  const reconcile = () => {
    const ids = new Set(available().map((item) => item.id))
    Object.entries(state.getSnapshot().disconnecting).forEach(([id, status]) => {
      if ((status === "removing" || status === "removed") && !ids.has(id)) {
        updateDisconnecting([id], "absent")

        return
      }

      if (status === "absent" && ids.has(id)) updateDisconnecting([id], undefined)
    })
  }
  // Connection state comes from the integration list like the TUI: credential
  // connections mean an API key or OAuth grant, env connections mean detected
  // environment variables, and a connectionless integration is config-provided.
  const source = (item: ProviderItem): ProviderSource | undefined => {
    const current = integration(item)
    const credential = current?.connections.find((connection) => connection.type === "credential")

    if (credential) return credential.method === "oauth" ? "account" : "api"

    if (current?.connections.some((connection) => connection.type === "env")) return "env"

    if (current) return "config"

    if (!("source" in item)) return
    const value = item.source

    if (value === "env" || value === "api" || value === "config" || value === "custom") return value

    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)

    if (current === "env") return language().t("settings.providers.tag.environment")

    if (current === "api") return language().t("provider.connect.method.apiKey")

    if (current === "account") return language().t("settings.providers.tag.account")

    if (current === "config") return language().t("settings.providers.tag.config")

    if (current === "custom") return language().t("settings.providers.tag.custom")

    return language().t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => {
    const current = integration(item)

    if (current) return current.connections.some((connection) => connection.type === "credential")
    const currentSource = source(item)

    return currentSource !== "env" && currentSource !== "config"
  }

  // A RedRouter connection says what its key may do: an admin key also manages keys over MCP.
  const keyRole = (item: ProviderItem) => {
    const role = services.snapshot.getSnapshot().roles[item.id]
    if (role === "admin") return language().t("settings.providers.tag.adminKey")
    if (role === "standard") return language().t("settings.providers.tag.standardKey")
  }

  const canManageAccounts = (item: ProviderItem) => providerAccounts(integration(item)).length > 0

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const disconnect = async (item: ProviderItem, name: string) => {
    if (state.getSnapshot().disconnecting[item.id]) return
    const group = consoleGroup()
    const ids = group?.root.id === item.id ? group.providers.map((provider) => provider.id) : [item.id]
    updateDisconnecting(ids, "removing")
    const location = services.snapshot.getSnapshot().directory
      ? { directory: services.snapshot.getSnapshot().directory }
      : undefined
    await services.snapshot
      .getSnapshot()
      .api.integration.get({ integrationID: item.integrationID ?? item.id, location })
      .then(async (integration) => {
        const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []

        if (credentials.length === 0) {
          services.notify({
            title: language().t("common.requestFailed"),
            description: language().t("provider.disconnect.toast.noCredentials.description", { provider: name }),
          })

          return
        }

        await Promise.all(
          credentials.map((credential) =>
            services.snapshot.getSnapshot().api.credential.remove({ credentialID: credential.id }),
          ),
        )
        updateDisconnecting(ids, "removed")
        services.notify({
          variant: "success",
          icon: "circle-check",
          title: language().t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language().t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        updateDisconnecting(ids, undefined)
        const message = err instanceof Error ? err.message : String(err)
        services.notify({
          title: language().t("common.requestFailed"),
          description: language().tDynamic("provider.disconnect.toast.failed.description", message, { provider: name }),
        })
      })
  }

  const refreshAccounts = services.refresh

  const accountError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    services.notify({ title: language().t("common.requestFailed"), description: message })
  }

  const activate = async (provider: ProviderItem, providerName: string, account: ProviderAccount) => {
    if (activeProviderAccount(integration(provider))?.id === account.id) return
    state.update({ credentialID: account.id })
    await services.snapshot
      .getSnapshot()
      .api.credential.activate({ credentialID: account.id })
      .then(refreshAccounts)
      .then(() =>
        services.notify({
          variant: "success",
          icon: "circle-check",
          title: language().t("settings.providers.account.switched.title", { provider: providerName }),
          description: language().t("settings.providers.account.switched.description", { account: account.label }),
        }),
      )
      .catch(accountError)
      .finally(() => state.update({ credentialID: undefined }))
  }

  const remove = async (provider: ProviderItem, providerName: string, account: ProviderAccount) => {
    const final = providerAccounts(integration(provider)).length === 1
    state.update({ credentialID: account.id })
    await services.snapshot
      .getSnapshot()
      .api.credential.remove({ credentialID: account.id })
      .then(refreshAccounts)
      .then(() =>
        services.notify({
          variant: "success",
          icon: "circle-check",
          title: language().t(
            final ? "provider.disconnect.toast.disconnected.title" : "settings.providers.account.removed.title",
            final ? { provider: providerName } : { account: account.label },
          ),
          description: language().t(
            final
              ? "provider.disconnect.toast.disconnected.description"
              : "settings.providers.account.removed.description",
            { provider: providerName },
          ),
        }),
      )
      .catch(accountError)
      .finally(() => state.update({ credentialID: undefined }))
  }

  const removeProvider = async (item: ProviderItem, name: string) => {
    const snapshot = services.snapshot.getSnapshot()
    await snapshot.api.provider
      .remove({
        providerID: item.integrationID ?? item.id,
        dryRun: true,
        location: snapshot.directory ? { directory: snapshot.directory } : undefined,
      })
      .then((preview) => {
        if (ProviderRemoval.empty(preview.data)) {
          services.notify({ title: language().t("settings.providers.remove.empty", { provider: name }) })
          return
        }
        state.update({ removal: { item, name, preview: preview.data } })
      })
      .catch(accountError)
  }
  const confirmRemoval = async () => {
    const removal = state.getSnapshot().removal
    if (!removal) return false
    const snapshot = services.snapshot.getSnapshot()
    return snapshot.api.provider
      .remove({
        providerID: removal.item.integrationID ?? removal.item.id,
        dryRun: false,
        location: snapshot.directory ? { directory: snapshot.directory } : undefined,
      })
      .then(services.refresh)
      .then(() => {
        services.notify({
          variant: "success",
          icon: "circle-check",
          title: language().t("settings.providers.remove.removed.title", { provider: removal.name }),
          description: language().t("settings.providers.remove.removed.description"),
        })
        state.update({ removal: undefined })
        return true
      })
      .catch((error) => {
        accountError(error)
        return false
      })
  }
  return {
    source: state,
    update: state.update,
    available,
    connected,
    displayed,
    consoleGroup,
    popular,
    reconcile,
    integration,
    type,
    canDisconnect,
    keyRole,
    canManageAccounts,
    note,
    connect,
    manage,
    disconnect,
    activate,
    remove,
    removeProvider,
    confirmRemoval,
  }
}

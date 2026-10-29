import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ProviderConnectionView } from "./connection.react"
import { ConnectProviderDialog } from "./dialog.react"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedMount } from "@/runtime/react/mount"
import { useDialog } from "@opencode/ui/context/dialog"
import { showToast } from "@/shell/notifications/toast"
import { type Component, createEffect, createMemo, Match, onCleanup, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { IntegrationConnections } from "@opencode/util/integration-connections"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useProviders } from "@/providers/catalog/providers"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { connectedProviderID } from "@/providers/catalog/connect-order"
import type { ModelSelection } from "@/providers/models/selection"
import { decode64 } from "@/runtime/persistence/base64"
import { useTabs } from "@/shell/tabs/tabs"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { Schema } from "effect"
import {
  CONSOLE_PROVIDERS,
  consoleIntegration,
  createProviderConnectionController,
  methodForm,
  providerFormDefaults,
} from "./controller"
import { DialogChatGPTPlanWelcome } from "./chatgpt-welcome"
import { IntegrationConnectionsPane } from "./manage"
import { authServerName } from "./remote"

import { ProviderPicker } from "./picker"
export { OPENAI_COMPATIBLE } from "@/providers/catalog/ids"

export function useProviderConnectController() {
  const [store, setStore] = createStore<{ selected?: string; adding: boolean }>({ adding: false })
  const reset = () => setStore({ selected: undefined, adding: false })

  return {
    selected: () => store.selected,
    /** True when the selected integration should start a new connection instead of listing its saved ones. */
    adding: () => store.adding,
    select: (provider?: string, options?: { add?: boolean }) =>
      setStore({ selected: provider, adding: options?.add ?? false }),
    reset,
  }
}

export const DialogConnectProvider: Component<{
  directory?: string
  /** Connects at the server's default Location instead of the current route's directory. */
  defaultLocation?: boolean
  controller?: ReturnType<typeof useProviderConnectController>
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: (provider: string) => void
  /** Closes the dialog after a connection and hands over the provider whose models to pick from. */
  onPickModel?: (provider: string) => void
}> = (props) => {
  const fallback = useProviderConnectController()
  const controller = props.controller ?? fallback

  const [state, setState] = createStore<{
    completed: boolean
    modelProvider?: { id: string; name: string }
    authorization: boolean
    chatgptWelcome: boolean
  }>({
    completed: false,
    authorization: false,
    chatgptWelcome: false,
  })

  const language = useLanguage()
  const dialog = useDialog()
  const modal = useNativeDialog()
  const integrations = useIntegrations(() => props.directory)

  const [welcome, setWelcome, , welcomeReady] = persisted(
    Persist.global("chatgpt-plan-welcome.v1"),
    Persistence.struct({ seen: Schema.Boolean }),
    { seen: false },
  )

  const reset = controller.reset
  const back = { current: reset }
  const consoleSelected = () => CONSOLE_PROVIDERS.has(controller.selected() ?? "")
  let focusHost: HTMLDivElement | undefined
  const holdFocus = () => focusHost?.focus({ preventScroll: true })

  const select = (provider?: string) => {
    back.current = reset
    const integration = integrations.list().find((item) => item.id === provider)
    controller.select(provider, {
      add: !!integration && !IntegrationConnections.credentialConnections(integration).length,
    })
  }

  // A connected integration opens its saved connections first; "Add connection…" starts a new one.
  const managing = () => {
    const selected = controller.selected()

    if (!selected || controller.adding() || CONSOLE_PROVIDERS.has(selected)) return undefined
    const integration = integrations.list().find((item) => item.id === selected)

    return integration && IntegrationConnections.credentialConnections(integration).length ? integration : undefined
  }

  function Content() {
    return (
      <Switch>
        <Match when={managing()} keyed>
          {(integration) => (
            <IntegrationConnectionsPane
              integrationID={integration.id}
              directory={props.defaultLocation ? undefined : props.directory}
              onAdd={() => controller.select(integration.id, { add: true })}
              onPickModel={
                props.onPickModel
                  ? (provider) => {
                      dialog.close()
                      props.onPickModel?.(provider)
                    }
                  : undefined
              }
            />
          )}
        </Match>
        <Match keyed when={controller.selected()}>
          {(provider) => (
            <ProviderConnection
              provider={provider}
              directory={props.directory}
              defaultLocation={props.defaultLocation}
              onBack={reset}
              setBack={(handler) => (back.current = handler)}
              selection={props.selection}
              onDone={props.onDone ? () => setState("completed", true) : undefined}
              onConnected={(methodID) => {
                props.onConnected?.(provider)

                if (provider === "openai" && methodID === "chatgpt-token-sharing") setState("chatgptWelcome", true)
              }}
              onPickModel={props.onPickModel}
              onFirstConnection={(provider) => setState("modelProvider", provider)}
              onAuthorization={(authorization) => setState("authorization", authorization)}
            />
          )}
        </Match>
        <Match when={true}>
          <ProviderPicker directory={props.directory} onSelect={select} onPrepare={holdFocus} />
        </Match>
      </Switch>
    )
  }

  onCleanup(() => {
    if (state.completed && props.onDone) queueMicrotask(props.onDone)
    if (!state.chatgptWelcome) return
    void Promise.resolve(welcomeReady.promise).then(() => {
      if (welcome.seen) return
      setWelcome("seen", true)
      void dialog.show(() => <DialogChatGPTPlanWelcome />)
    })
  })
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    selected: controller.selected(),
    consoleSelected: consoleSelected(),
    modelProvider: state.modelProvider ? { ...state.modelProvider } : undefined,
    authorization: state.authorization,
    title: state.modelProvider
      ? language.t("provider.connect.models.title", { provider: state.modelProvider.name })
      : !controller.selected()
        ? language.t("command.provider.connect")
        : consoleSelected()
          ? language.t("provider.connect.console.title")
          : language.t("provider.connect.title", {
              provider:
                integrations.list().find((item) => item.id === controller.selected())?.name ??
                controller.selected() ??
                "",
            }),
  }))
  const content = sharedMount(() => (
    <div ref={focusHost} tabIndex={-1} class="flex min-h-0 flex-1 flex-col outline-none">
      <Content />
    </div>
  ))
  return (
    <ReactView
      component={ConnectProviderDialog}
      props={{ source, content, close: modal.close, back: () => back.current() }}
    />
  )
}

export function createProviderConnectionServices(props: {
  provider: string
  directory?: string
  defaultLocation?: boolean
  onBack: () => void
  setBack: (handler: () => void) => void
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: (methodID?: string) => void
  onPickModel?: (provider: string) => void
  onFirstConnection: (provider: { id: string; name: string }) => void
  onAuthorization: (authorization: boolean) => void
}) {
  const dialog = useDialog()
  const params = useParams()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useServerSDK()
  const data = useData()
  const global = useGlobal()
  const tabs = useTabs()
  // A sign-in belongs to the Location where it began, even if the route changes underneath it.
  const initialDirectory = props.defaultLocation ? undefined : (props.directory ?? decode64(params.dir))
  const directory = () => initialDirectory
  const location = () => (initialDirectory ? { directory: initialDirectory } : undefined)
  const providers = useProviders(directory)
  const integrations = useIntegrations(directory)
  const integrationID = consoleIntegration(props.provider)
  const isConsole = CONSOLE_PROVIDERS.has(props.provider)
  const remote = isConsole && authServerName(sdk.server) !== undefined

  const [state, setState] = createStore<{
    copied: boolean
    copyFailed: boolean
    firstConnection?: boolean
    models: boolean
    noModels: boolean
    catalogPending: boolean
    selectedModel: string
    collapsed: Record<string, boolean>
  }>({
    copied: false,
    copyFailed: false,
    models: false,
    noModels: false,
    // The workspace providers had not loaded when the wait ran out.
    catalogPending: false,
    selectedModel: "",
    collapsed: {},
  })

  const controller = createProviderConnectionController({
    provider: () => integrationID,
    // A Go service-account key still belongs to the `opencode-go` integration (zen/go/v1),
    // exactly as before; only the sign-in is shared with the Console.
    keyProvider: () => props.provider,
    directory,
    autoSelect: (methods) => {
      if (!isConsole) return undefined
      const index = methods.findIndex((method) => method.type === "oauth")

      return index === -1 ? undefined : index
    },
    prepare: isConsole ? prepareConsoleCatalog : props.provider === "openai" ? prepareChatGPTCatalog : undefined,
    pollInterval: isConsole ? 500 : undefined,
    onComplete: () => {
      const method = controller.currentMethod()
      props.onConnected?.(method?.type === "oauth" ? method.id : undefined)
      // Reconnecting brings back models that were hidden in Settings › Models.
      global.models.show(connectionModels().map((model) => ({ providerID: model.providerID, modelID: model.id })))
      if (state.catalogPending) {
        setState("noModels", true)

        return
      }
      if (
        accountCatalog() &&
        (accountCatalog()?.status === "error" || accountCatalog()?.status === "loading" || !connectionModels().length)
      ) {
        setState("noModels", true)
        return
      }

      // Like the TUI, a connection opened from a model picker returns to it, filtered to the new provider.
      const picked = connectedProviderID(connectionProviders(), data.location.model.list(location()) ?? [], target())

      if (props.onPickModel && picked && connectionModels().length > 0) {
        dialog.close()
        props.onPickModel(picked)

        return
      }

      if (state.firstConnection) {
        const first = connectionGroups()[0]?.models[0]

        if (first) {
          setState({ models: true, selectedModel: modelKey(first) })
          props.onFirstConnection({ id: props.provider, name: provider().name })

          return
        }

        // Keep the "connected, but no models" state visible so the workspace can be fixed.
        if (isConsole) {
          setState("noModels", true)

          return
        }
      }

      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
        description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
      })
    },
  })

  // Captured before the new credential lands, so the connection itself never counts as existing.
  createEffect(() => {
    if (state.firstConnection !== undefined) return
    const existing = providers.anyConnection()

    if (existing === undefined) return
    setState("firstConnection", !existing)
  })

  // Credentials saved before this connection; a wizard such as the OpenAI-compatible endpoint files
  // its key under the provider it defines, so the new credential tells which integration it made.
  const saved = { ids: undefined as Set<string> | undefined }
  createEffect(() => {
    if (saved.ids || !integrations.ready()) return
    saved.ids = new Set(
      integrations
        .list()
        .flatMap((item) => IntegrationConnections.credentialConnections(item).map((connection) => connection.id)),
    )
  })

  const target = createMemo(() => {
    const before = saved.ids

    if (!before) return integrationID

    return (
      integrations
        .list()
        .find((item) =>
          IntegrationConnections.credentialConnections(item).some((connection) => !before.has(connection.id)),
        )?.id ?? integrationID
    )
  })

  const connectionProviders = createMemo(() =>
    (data.location.provider.list(location()) ?? []).filter(
      (provider) => provider.id === props.provider || provider.integrationID === target() || provider.id === target(),
    ),
  )
  const accountCatalog = createMemo(() => connectionProviders().find((provider) => provider.catalog)?.catalog)

  const connectionModels = createMemo(() => {
    const ids = new Set(connectionProviders().map((provider) => provider.id))

    return (data.location.model.list(location()) ?? []).filter(
      (model) => ids.has(model.providerID) && model.enabled && model.status !== "deprecated",
    )
  })

  const connectionGroups = createMemo(() => {
    const models = connectionModels()

    return connectionProviders()
      .map((provider) => ({ provider, models: models.filter((model) => model.providerID === provider.id) }))
      .filter((group) => group.models.length > 0)
  })

  const managedProviders = createMemo(() => (isConsole ? consoleProviderGroup(connectionProviders()) : undefined))

  // The server loads the Console workspace's providers after the grant lands, so the first refresh
  // can still show only the free catalog. Poll briefly for the workspace providers before moving on.
  async function prepareConsoleCatalog(active: () => boolean) {
    if (controller.currentMethod()?.type === "key") return active()

    const loaded = () =>
      managedProviders() !== undefined || connectionProviders().some((provider) => provider.id !== "opencode")

    const deadline = Date.now() + 10_000

    while (!loaded() && active() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))

      if (!active()) return false
      data.location.provider.invalidate(location())
      data.location.model.invalidate(location())
      await Promise.all([data.location.provider.sync(location()), data.location.model.sync(location())]).catch(
        () => undefined,
      )
    }

    setState("catalogPending", !loaded())

    return active()
  }

  async function prepareChatGPTCatalog(active: () => boolean) {
    const method = controller.currentMethod()
    if (method?.type !== "oauth" || method.id !== "chatgpt-token-sharing") return active()
    await sdk.api.provider.refresh({ providerID: "openai", location: location() }).catch(() => undefined)
    if (!active()) return false
    data.location.provider.invalidate(location())
    data.location.model.invalidate(location())
    const loaded = await Promise.all([data.location.provider.sync(location()), data.location.model.sync(location())])
      .then(() => true)
      .catch(() => false)
    if (!loaded) return false
    setState("catalogPending", accountCatalog()?.status === "loading")
    return active()
  }

  const connectionGroupName = (name: string) => {
    const managed = managedProviders()

    return managed ? consoleProviderName(managed, name) : name
  }

  const modelKey = (model: { providerID: string; id: string }) => `${model.providerID}:${model.id}`
  const selectedModel = () => connectionModels().find((model) => modelKey(model) === state.selectedModel)

  const copyLink = async () => {
    const url = controller.authorization()?.url

    if (!url) return

    const copied = await Promise.resolve()
      .then(() => (platform.writeClipboardText ? platform.writeClipboardText(url) : navigator.clipboard.writeText(url)))
      .then(() => true)
      .catch(() => false)

    if (controller.authorization()?.url !== url) return
    setState({ copied, copyFailed: !copied })
  }

  createEffect(() => {
    controller.authorization()?.attemptID
    setState({ copied: false, copyFailed: false })
  })
  createEffect(() => {
    const current = controller.auth.state()
    props.onAuthorization(
      controller.authorization() !== undefined && (current === "waiting" || current === "refreshing"),
    )
  })

  const provider = createMemo(() => ({
    id: props.provider,
    name:
      integrations.list().find((item) => item.id === props.provider)?.name ??
      providers.all().get(props.provider)?.name ??
      controller.integration()?.name ??
      props.provider,
  }))

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""

    if (value.type === "key") return language.t("provider.connect.method.apiKey")

    return value.label ?? ""
  }

  const methodDetails = (value?: { type?: string; label?: string }) => {
    const label = methodLabel(value)
    const suffix = value?.label?.match(/\s+\((browser|headless)\)$/i)
    const hint = suffix?.[1]

    return {
      label: suffix ? label.slice(0, -suffix[0].length) : label,
      hint:
        hint?.toLowerCase() === "headless"
          ? language.t("provider.connect.method.headless")
          : hint?.toLowerCase() === "browser" || (!hint && value?.type === "key")
            ? language.t("provider.connect.method.browser")
            : undefined,
    }
  }

  const code = createMemo(() => {
    const authorization = controller.authorization()

    if (!authorization) return
    const userCode = new URL(authorization.url).searchParams.get("user_code")

    if (userCode) return userCode
    const instructions = authorization.instructions

    if (instructions?.includes(":")) return instructions.split(":").pop()?.trim()

    return instructions
  })

  const keyIndex = () => controller.methods().findIndex((method) => method.type === "key")
  const oauthIndex = () => controller.methods().findIndex((method) => method.type === "oauth")

  // The Console device flow owns the dialog from the first frame until the catalogs are loaded.
  const consoleSignIn = () =>
    isConsole &&
    !state.noModels &&
    controller.currentMethod()?.type !== "key" &&
    controller.auth.state() !== "error" &&
    (controller.busy() || controller.authorization()?.mode === "auto")

  function goBack() {
    // The API key path for the Console is an escape hatch below the sign-in flow, so
    // "back" returns to the sign-in rather than leaving the provider.
    if (isConsole && controller.currentMethod()?.type === "key" && oauthIndex() !== -1) {
      void controller.auth.select(oauthIndex())

      return
    }

    if (!isConsole && controller.methods().length > 1 && controller.methodIndex() !== undefined) {
      controller.auth.reset()

      return
    }

    props.onBack()
  }

  props.setBack(goBack)

  const startWithModel = async () => {
    const model = selectedModel()

    if (!model) return
    const selection = { providerID: model.providerID, modelID: model.id }

    if (props.selection) {
      props.selection.set(selection)
      props.onDone?.()
      dialog.close()

      return
    }

    dialog.close()
    await tabs.newDraft(
      {
        server: ServerConnection.key(sdk.server),
        directory: initialDirectory ?? data.location.default().directory,
      },
      undefined,
      selection,
    )
  }

  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      provider: provider(),
      isConsole,
      remoteName: remote ? authServerName(sdk.server) : undefined,
      state: { ...state, collapsed: { ...state.collapsed } },
      busy: controller.busy(),
      loading: controller.loading(),
      authState: controller.auth.state(),
      error: controller.auth.error(),
      methodIndex: controller.methodIndex(),
      method: controller.currentMethod(),
      methods: controller.methods().map((method) => ({ ...method, ...methodDetails(method) })),
      form: methodForm(controller.currentMethod()),
      defaults: providerFormDefaults(methodForm(controller.currentMethod())),
      code: code(),
      output: controller.output(),
      browserFailed: controller.browserFailed(),
      authorization: controller.authorization(),
      consoleSignIn: consoleSignIn(),
      keyIndex: keyIndex(),
      managed: managedProviders(),
      catalog: accountCatalog(),
      groups: connectionGroups().map((group) => ({
        provider: { ...group.provider, name: connectionGroupName(group.provider.name) },
        models: group.models.map((model) => ({ ...model })),
      })),
    })),
    auth: controller.auth,
    update: (patch: Partial<typeof state>) => setState(patch),
    copyLink: () => void copyLink(),
    openConsole: () => platform.openExternal("https://opencode.ai/console"),
    copyCode: (value: string) =>
      platform.writeClipboardText ? platform.writeClipboardText(value) : navigator.clipboard.writeText(value),
    keyError: (error: unknown) => formatServerError(error, language.t),
    startWithModel: () => void startWithModel(),
  }
}

function ProviderConnection(props: Parameters<typeof createProviderConnectionServices>[0]) {
  const services = createProviderConnectionServices(props)
  return <ReactView component={ProviderConnectionView} props={{ services }} />
}

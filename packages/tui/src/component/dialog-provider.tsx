import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "../context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@reddb-io/redcode-sdk/v2"
import { DialogModel } from "./dialog-model"
import { useToast } from "../ui/toast"
import { isConsoleManagedProvider } from "../util/provider-origin"
import { useConnected } from "./use-connected"
import { useBindings } from "../keymap"
import { useClipboard } from "../context/clipboard"
import { type ConnectedProvider, DialogOpenAICompatible, type ProviderPreset } from "./dialog-openai-compatible"
import {
  COMPATIBLE_NPM,
  connectionProblem,
  isNineRouterDefaultURL,
  isRedRouterDefaultURL,
  NINE_ROUTER_DEFAULT_URL,
  NINE_ROUTER_ID,
  NINE_ROUTER_NAME,
  RED_ROUTER_DEFAULT_URL,
  RED_ROUTER_ID,
  RED_ROUTER_NAME,
} from "../util/openai-compatible"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

const COMPATIBLE_OPTION_VALUE = "__openai_compatible_provider__"

const NINE_ROUTER_PRESET: ProviderPreset = {
  providerID: NINE_ROUTER_ID,
  name: NINE_ROUTER_NAME,
  defaultURL: NINE_ROUTER_DEFAULT_URL,
  urlHint: "Start 9Router, then confirm its API URL, such as localhost:20128.",
  keyHint: "Copy a key from the 9Router dashboard.",
}

const RED_ROUTER_PRESET: ProviderPreset = {
  providerID: RED_ROUTER_ID,
  name: RED_ROUTER_NAME,
  defaultURL: RED_ROUTER_DEFAULT_URL,
  urlHint: "Start RedRouter, then confirm its API URL, such as localhost:25050.",
  keyHint: "Copy a key from the RedRouter dashboard.",
}

type ProviderOptionBase = {
  title: string
  value: string
  description?: string
  category: string
}

type ProviderOption =
  | (ProviderOptionBase & {
      type: "provider"
      providerID: string
    })
  | (ProviderOptionBase & {
      type: "compatible"
    })

export function providerOptions(
  list: { id: string; name: string }[],
  disabled: readonly string[] = [],
): ProviderOption[] {
  const compatible: ProviderOption = {
    type: "compatible",
    title: "OpenAI-compatible",
    value: COMPATIBLE_OPTION_VALUE,
    description: "Any endpoint that speaks the OpenAI API: custom base URL and API key",
    category: "Popular",
  }
  const providers = pipe(
    list.some((provider) => provider.id === NINE_ROUTER_ID) || disabled.includes(NINE_ROUTER_ID)
      ? list
      : [...list, { id: NINE_ROUTER_ID, name: "9Router" }],
    (list) =>
      list.some((provider) => provider.id === RED_ROUTER_ID) || disabled.includes(RED_ROUTER_ID)
        ? list
        : [...list, { id: RED_ROUTER_ID, name: RED_ROUTER_NAME }],
    sortBy(
      (x) => PROVIDER_PRIORITY[x.id] ?? 99,
      (x) => x.name.toLowerCase(),
      (x) => x.id,
    ),
    map((provider) => ({
      type: "provider" as const,
      title: provider.name,
      value: provider.id,
      providerID: provider.id,
      description: {
        opencode: "(Recommended)",
        anthropic: "(API key)",
        openai: "(ChatGPT Plus/Pro or API key)",
        "opencode-go": "Low cost subscription for everyone",
        "9router": "Local router · automatic model setup",
        "red-router": "Local router · automatic model setup",
      }[provider.id],
      category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Providers",
    })),
  )
  // Right after the popular providers, before the long alphabetical list.
  const popular = providers.filter((option) => option.category === "Popular").length
  return [...providers.slice(0, popular), compatible, ...providers.slice(popular)]
}

type Connected = (providerID: string) => void | Promise<void>

export function createDialogProviderOptions(props: { onConnected?: Connected } = {}) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const onboarded = useConnected()

  function lookup(providerID: string) {
    const configured = sync.data.config.provider?.[providerID]
    const compatible = !!configured && COMPATIBLE_NPM.some((npm) => npm === configured.npm)
    const baseURL = configured?.options?.baseURL
    return {
      existing: compatible
        ? {
            name: configured.name,
            baseURL: typeof baseURL === "string" ? baseURL : undefined,
            npm: configured.npm,
            hasKey: !!configured.options?.apiKey || sync.data.provider_next.connected.includes(providerID),
            hasModels: Object.keys(configured.models ?? {}).length > 0,
          }
        : undefined,
      taken:
        !compatible && (!!configured || sync.data.provider_next.all.some((provider) => provider.id === providerID)),
    }
  }

  async function afterConnect(result: ConnectedProvider, signal: AbortSignal) {
    // The server reloaded before answering, so these reads include the connection.
    // sync.data catches up from the reload event and may still be stale here.
    const [config, providers] = await Promise.all([
      sdk.client.config.get({}, { throwOnError: true, signal }),
      sdk.client.config.providers({}, { throwOnError: true, signal }),
    ])
    if (signal.aborted) return
    const problem = connectionProblem({
      providerID: result.providerID,
      name: result.name,
      baseURL: result.baseURL,
      credential: result.credential,
      options: config.data.provider?.[result.providerID]?.options,
      providers: providers.data.providers,
    })
    if (problem) throw new Error(problem)
    toast.show({
      variant: "info",
      message:
        `${result.name} saved as provider "${result.providerID}"${result.movedFrom ? ` (moved from "${result.movedFrom}")` : ""} in ${result.configPath}.` +
        (result.projectReferences?.length
          ? ` These files still mention "${result.movedFrom}" and were not changed: ${result.projectReferences.join(", ")}.`
          : ""),
    })
    if (props.onConnected) {
      await sync.bootstrap()
      return props.onConnected(result.providerID)
    }
    dialog.replace(() => <DialogModel providerID={result.providerID} />)
  }

  /** A configured OpenAI-compatible provider that is not a catalog or plugin provider opens the wizard. */
  function isCustomCompatible(providerID: string) {
    const provider = sync.data.provider_next.all.find((item) => item.id === providerID)
    return !!lookup(providerID).existing && !sync.data.provider_auth[providerID] && !provider?.env.length
  }

  const options = createMemo(() => {
    return pipe(
      providerOptions(sync.data.provider_next.all, sync.data.config.disabled_providers),
      map((provider) => {
        if (provider.type === "compatible") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            onSelect() {
              dialog.replace(() => <DialogOpenAICompatible lookup={lookup} onConnected={afterConnect} />)
            },
          }
        }

        const providerID = provider.providerID
        const consoleManaged = isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerID)
        const connected = sync.data.provider_next.connected.includes(providerID)

        return {
          title: provider.title,
          value: provider.value,
          description: provider.description,
          footer: consoleManaged ? sync.data.console_state.activeOrgName : undefined,
          category: provider.category,
          gutter: connected && onboarded() ? () => <text fg={theme.success}>✓</text> : undefined,
          async onSelect() {
            if (consoleManaged) return

            if (providerID === NINE_ROUTER_ID) {
              const configured = lookup(providerID).existing?.baseURL
              return dialog.replace(() => (
                <DialogOpenAICompatible
                  preset={NINE_ROUTER_PRESET}
                  offerMove={!!configured && !isNineRouterDefaultURL(configured)}
                  lookup={lookup}
                  onConnected={afterConnect}
                />
              ))
            }

            if (providerID === RED_ROUTER_ID) {
              const configured = lookup(providerID).existing?.baseURL
              return dialog.replace(() => (
                <DialogOpenAICompatible
                  preset={RED_ROUTER_PRESET}
                  offerMove={!!configured && !isRedRouterDefaultURL(configured)}
                  lookup={lookup}
                  onConnected={afterConnect}
                />
              ))
            }

            if (isCustomCompatible(providerID)) {
              return dialog.replace(() => (
                <DialogOpenAICompatible providerID={providerID} lookup={lookup} onConnected={afterConnect} />
              ))
            }

            const methods = sync.data.provider_auth[providerID] ?? [
              {
                type: "api",
                label: "API key",
              },
            ]
            let index: number | null = 0
            if (methods.length > 1) {
              index = await new Promise<number | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title="Select auth method"
                      options={methods.map((x, index) => ({
                        title: x.label,
                        value: index,
                      }))}
                      onSelect={(option) => resolve(option.value)}
                    />
                  ),
                  () => resolve(null),
                )
              })
            }
            if (index == null) return
            const method = methods[index]
            if (method.type === "oauth") {
              let inputs: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({
                  dialog,
                  prompts: method.prompts,
                })
                if (!value) return
                inputs = value
              }

              const result = await sdk.client.provider.oauth.authorize({
                providerID,
                method: index,
                inputs,
              })
              if (result.error) {
                toast.show({
                  variant: "error",
                  message: JSON.stringify(result.error),
                })
                dialog.clear()
                return
              }
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod
                    providerID={providerID}
                    title={method.label}
                    index={index}
                    authorization={result.data!}
                    onConnected={props.onConnected}
                  />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod
                    providerID={providerID}
                    title={method.label}
                    index={index}
                    authorization={result.data!}
                    onConnected={props.onConnected}
                  />
                ))
              }
            }
            if (method.type === "api") {
              let metadata: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({ dialog, prompts: method.prompts })
                if (!value) return
                metadata = value
              }
              return dialog.replace(() => (
                <ApiMethod
                  providerID={providerID}
                  title={method.label}
                  metadata={metadata}
                  onConnected={props.onConnected}
                />
              ))
            }
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider(props: { onConnected?: Connected } = {}) {
  const options = createDialogProviderOptions(props)
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
  onConnected?: Connected
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const clipboard = useClipboard()

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "Copy provider code",
        group: "Dialog",
        cmd: () => {
          const code =
            props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
          clipboard
            .write?.(code)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      toast.show({
        variant: "error",
        message:
          "name" in result.error && result.error.name === "ProviderAuthOauthCallbackFailed"
            ? "OAuth authorization failed. Try /connect again."
            : JSON.stringify(result.error),
      })
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    if (props.onConnected) return props.onConnected(props.providerID)
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization…</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
  onConnected?: Connected
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          if (props.onConnected) await props.onConnected(props.providerID)
          else dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
  metadata?: Record<string, string>
  onConnected?: Connected
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  // Saving a key disposes and re-bootstraps the instance, which can take tens of seconds when
  // plugins or provider packages are (re)installed. Without a busy state the dialog looks frozen
  // and every extra enter re-submits the key.
  const [busy, setBusy] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      busy={busy()}
      busyText="Saving credential and reloading providers..."
      description={() =>
        ({
          opencode: (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API
                key.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
              </text>
            </box>
          ),
          "opencode-go": (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Go is a $10 per month subscription that provides reliable access to popular open coding models
                with generous usage limits.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/go</span> and enable OpenCode Go
              </text>
            </box>
          ),
        })[props.providerID] ?? undefined
      }
      onConfirm={async (value) => {
        if (!value || busy()) return
        setBusy(true)
        try {
          const result = await sdk.client.auth.set({
            providerID: props.providerID,
            auth: {
              type: "api",
              key: value,
              ...(props.metadata ? { metadata: props.metadata } : {}),
            },
          })
          if (result.error) {
            toast.show({ variant: "error", message: JSON.stringify(result.error) })
            return
          }
          await sdk.client.instance.dispose()
          await sync.bootstrap()
        } catch (error) {
          toast.show({
            variant: "error",
            message: `Failed to save credential: ${error instanceof Error ? error.message : String(error)}`,
          })
          return
        } finally {
          setBusy(false)
        }
        if (props.onConnected) await props.onConnected(props.providerID)
        else dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

interface PromptsMethodProps {
  dialog: ReturnType<typeof useDialog>
  prompts: NonNullable<ProviderAuthMethod["prompts"]>[number][]
}
async function PromptsMethod(props: PromptsMethodProps) {
  const inputs: Record<string, string> = {}
  for (const prompt of props.prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }

    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        props.dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((x) => ({
                title: x.label,
                value: x.value,
                description: x.hint,
              }))}
              onSelect={(option) => resolve(option.value)}
            />
          ),
          () => resolve(null),
        )
      })
      if (value === null) return null
      inputs[prompt.key] = value
      continue
    }

    const value = await new Promise<string | null>((resolve) => {
      props.dialog.replace(
        () => (
          <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(value) => resolve(value)} />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}

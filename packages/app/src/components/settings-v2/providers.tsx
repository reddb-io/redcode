import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { Tag } from "@reddb-io/redcode-ui/v2/badge-v2"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { ProviderIcon } from "@reddb-io/redcode-ui/provider-icon"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, type Accessor, type Component, For, Show } from "solid-js"
import { useServerProtocol } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogConnectProvider, useProviderConnectController } from "../dialog-connect-provider"
import { DialogCustomProvider } from "../dialog-custom-provider"
import { useProviderRemove } from "../dialog-remove-provider"
import { SettingsListV2 } from "./parts/list"
import { routerName } from "../model-origin"
import "./settings-v2.css"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "Curated models including Claude, GPT, Gemini and more" },
  { match: (id: string) => id === "opencode-go", key: "Low cost subscription for everyone" },
  { match: (id: string) => id === "anthropic", key: "Direct access to Claude models, including Pro and Max" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "AI models for coding assistance via GitHub Copilot" },
  { match: (id: string) => id === "openai", key: "GPT models for fast, capable general AI tasks" },
  { match: (id: string) => id === "google", key: "Gemini models for fast, structured responses" },
  { match: (id: string) => id === "openrouter", key: "Access all supported models from one provider" },
  { match: (id: string) => id === "vercel", key: "Unified access to AI models with smart routing" },
] as const

const PROVIDER_ICON_SIZE = 16

export const SettingsProvidersV2: Component<{
  directory: Accessor<string | undefined>
  onBack?: () => void
}> = (props) => {
  const dialog = useDialog()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const providers = useProviders(props.directory)
  const providerConnect = useProviderConnectController({ onBack: props.onBack })
  const removeProvider = useProviderRemove({ v2: true, directory: props.directory })

  const connect = (provider?: string) => {
    providerConnect.select(provider)
    void dialog.show(() => <DialogConnectProvider directory={props.directory} controller={providerConnect} />)
  }

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  // A RedRouter connection says what its key may do: an admin key also manages keys over MCP.
  const keyRole = (item: ProviderItem) => {
    const role = item.router?.role
    if (role === "admin") return "Admin key"
    if (role === "standard") return "Standard key"
    return undefined
  }

  const type = (item: ProviderItem) => {
    const router = routerName(item)
    if (router) return router
    const current = source(item)
    if (current === "env") return "Environment"
    if (current === "api") return "API key"
    if (current === "config") {
      if (isConfigCustom(item.id)) return "Custom"
      return "Config"
    }
    if (current === "custom") return "Custom"
    return "Other"
  }

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = serverSync().data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{"Providers"}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-providers">
        <div class="settings-v2-section" data-component="connected-providers-section">
          <h3 class="settings-v2-section-title">{"Connected providers"}</h3>
          <SettingsListV2>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="settings-v2-provider-empty">{"No connected providers"}</div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="settings-v2-provider-row group">
                    <div class="settings-v2-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-v2-provider-icon shrink-0"
                      />
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name truncate">{item.name}</span>
                        <Tag>{type(item)}</Tag>
                      <Show when={keyRole(item)}>{(role) => <Tag>{role()}</Tag>}</Show>
                      </div>
                    </div>
                    <ButtonV2
                      size="normal"
                      variant="ghost-muted"
                      onClick={() => void removeProvider(item.id, item.name)}
                    >
                      {"Remove"}
                    </ButtonV2>
                  </div>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{"Popular providers"}</h3>
          <SettingsListV2>
            <For each={popular()}>
              {(item) => (
                <div class="settings-v2-provider-row">
                  <div class="settings-v2-provider-lead">
                    <ProviderIcon
                      id={item.id}
                      width={PROVIDER_ICON_SIZE}
                      height={PROVIDER_ICON_SIZE}
                      class="settings-v2-provider-icon shrink-0"
                    />
                    <div class="settings-v2-provider-copy">
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name">{item.name}</span>
                        <Show when={item.id === "opencode" || item.id === "opencode-go"}>
                          <Tag>{"Recommended"}</Tag>
                        </Show>
                      </div>
                      <Show when={note(item.id)}>
                        {(key) => <p class="settings-v2-provider-description">{key()}</p>}
                      </Show>
                    </div>
                  </div>
                  <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                    {"Connect"}
                  </ButtonV2>
                </div>
              )}
            </For>

            <Show when={protocol() === "v1"}>
              <div class="settings-v2-provider-row" data-component="custom-provider-section">
                <div class="settings-v2-provider-lead">
                  <ProviderIcon
                    id="synthetic"
                    width={PROVIDER_ICON_SIZE}
                    height={PROVIDER_ICON_SIZE}
                    class="settings-v2-provider-icon shrink-0"
                  />
                  <div class="settings-v2-provider-copy">
                    <div class="settings-v2-provider-main">
                      <span class="settings-v2-provider-name">{"Custom provider"}</span>
                      <Tag>{"Custom"}</Tag>
                    </div>
                    <p class="settings-v2-provider-description">
                      {"Add an OpenAI-compatible provider by base URL."}
                    </p>
                  </div>
                </div>
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  icon="plus"
                  onClick={() => {
                    dialog.show(() => <DialogCustomProvider onBack={dialog.close} />)
                  }}
                >
                  {"Connect"}
                </ButtonV2>
              </div>
            </Show>
          </SettingsListV2>

          <button type="button" class="settings-v2-providers-view-all" onClick={() => connect()}>
            {"Show more providers"}
          </button>
        </div>
      </div>
    </>
  )
}

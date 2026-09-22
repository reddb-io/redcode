import type { ParentProps } from "solid-js"
import type { ProviderAuthMethod } from "@reddb-io/redcode-sdk/v2/client"

const data = {
  provider: {
    all: new Map(),
    connected: [],
    default: {},
  },
  provider_auth: {} as Record<string, ProviderAuthMethod[]>,
  config: { disabled_providers: [] as string[] },
}

export function mockProviderAuth(provider: string, methods: ProviderAuthMethod[]) {
  const previous = data.provider_auth[provider]
  data.provider_auth[provider] = methods
  return () => {
    if (previous) {
      data.provider_auth[provider] = previous
      return
    }
    delete data.provider_auth[provider]
  }
}

export function useServerSync() {
  return () => ({
    data,
    set(key: "provider_auth", value: typeof data.provider_auth) {
      data[key] = value
    },
    updateConfig: async () => {},
  })
}

// Stories render real settings components that wrap their content in this provider.
export function ServerSyncProvider(props: ParentProps) {
  return props.children
}

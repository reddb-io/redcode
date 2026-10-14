import { useQuery } from "@tanstack/solid-query"
import { useServerSDK } from "./client"
import type { ServerScope } from "./scope"
import { errorStatus } from "@/shell/errors/description"

export const intelligenceSettingsKey = (scope: ServerScope) => [scope, "intelligence", "settings"] as const

/** One host-owned settings read shared by model selection, drafts and the settings screen. */
export function useIntelligenceSettings() {
  const server = useServerSDK()
  const query = useQuery(() => ({
    queryKey: intelligenceSettingsKey(server.scope),
    queryFn: ({ signal }) => server.api["server.intelligence"].status(undefined, { signal }),
    enabled: server.connection.status() === "connected",
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: "always" as const,
  }))
  return {
    status: () => query.data,
    error: () => query.error,
    ready: () => query.isSuccess || (query.isError && errorStatus(query.error) === 404),
    refetch: () => query.refetch({ cancelRefetch: false }),
  }
}

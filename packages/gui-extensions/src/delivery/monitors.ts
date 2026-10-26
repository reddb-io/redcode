import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { MonitorPublicInfo } from "@opencode/client/promise"
import { useExtension, type MountedSession, type ServerRef } from "../sdk"
import type { DeliverySection } from "./resources-model"

export function createDeliveryMonitors(props: { session: MountedSession; visible: boolean; section: DeliverySection }) {
  const ctx = useExtension()
  const cache = useQueryClient()
  const enabled = () => props.visible && props.session.server.connected && props.section === "monitors"
  const query = useQuery(() => {
    const server = props.session.server
    const sessionID = props.session.id
    return {
      queryKey: ["delivery-monitors", server.id, sessionID],
      enabled: enabled(),
      queryFn: ({ signal }) => server.client.session.monitor.list({ sessionID }, { signal }),
      retry: false,
      refetchInterval: enabled() ? 5000 : false,
    }
  })
  const cancel = useMutation(() => ({
    mutationFn: async (input: { server: ServerRef; sessionID: string; monitorID: string }) => ({
      ...input,
      monitor: await input.server.client.session.monitor.cancel(
        { sessionID: input.sessionID, monitorID: input.monitorID },
        { signal: ctx.signal },
      ),
    }),
    onSuccess: (result) => {
      if (ctx.signal.aborted) return
      cache.setQueryData<readonly MonitorPublicInfo[]>(
        ["delivery-monitors", result.server.id, result.sessionID],
        (current) => current?.map((item) => (item.id === result.monitor.id ? result.monitor : item)),
      )
    },
  }))
  const current = () =>
    cancel.variables?.server.id === props.session.server.id && cancel.variables.sessionID === props.session.id
  return {
    snapshot: () => ({
      items: query.data ?? [],
      loading: query.isPending,
      unavailable: query.isError,
      refreshing: query.isFetching,
      connected: props.session.server.connected,
      cancelling: current() && cancel.isPending,
      cancelFailed: current() && cancel.isError,
    }),
    actions: {
      refresh: () => void query.refetch(),
      cancel: (monitorID: string) =>
        cancel.mutate({ server: props.session.server, sessionID: props.session.id, monitorID }),
    },
  }
}

export type DeliveryMonitors = ReturnType<typeof createDeliveryMonitors>

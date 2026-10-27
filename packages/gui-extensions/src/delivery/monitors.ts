import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { MonitorPublicInfo } from "@opencode/client/promise"
import { createVisitState, useExtension, type MountedSession, type ServerRef } from "../sdk"
import { deliveryResources, type DeliverySection } from "./resources-model"

export function createDeliveryMonitors(props: { session: MountedSession; visible: boolean; section: DeliverySection }) {
  const ctx = useExtension()
  const cache = useQueryClient()
  const enabled = () => props.visible && props.session.server.connected && props.section === "monitors"
  const [inspecting, setInspecting] = createVisitState("")
  const session = useQuery(() => {
    const server = props.session.server
    const sessionID = server.data.session.root(props.session.id)
    return {
      queryKey: ["delivery-session", server.id, sessionID],
      queryFn: ({ signal }) => server.client.session.get({ sessionID }, { signal }),
      enabled: enabled(),
      retry: false,
      refetchInterval: enabled() ? 5000 : false,
    }
  })
  const resources = () => deliveryResources(session.data?.metadata)
  const selected = () => resources().value.harnesses.find((run) => run.runID === inspecting())
  const native = useQuery(() => {
    const server = props.session.server
    const runID = selected()?.runID ?? ""
    return {
      queryKey: ["delivery-harness-detail", server.id, runID],
      queryFn: ({ signal }) => server.client.harness.read({ runID }, { signal }),
      enabled: enabled() && !!runID && !session.isError && !resources().invalid,
      retry: false,
      refetchInterval: enabled() && !!runID && !session.isError && !resources().invalid ? 5000 : false,
    }
  })
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
      refreshing: query.isFetching || session.isFetching || native.isFetching,
      connected: props.session.server.connected,
      cancelling: current() && cancel.isPending,
      cancelFailed: current() && cancel.isError,
      harnesses: resources().value.harnesses,
      harnessLinksLoading: session.isPending,
      harnessLinksFailed: session.isError || resources().invalid,
      harnessID: selected()?.runID ?? "",
      native: selected() ? native.data : undefined,
      nativeLoading: !!selected() && native.isPending,
      nativeFailed: !!selected() && native.isError,
    }),
    actions: {
      refresh: () => {
        void query.refetch()
        void session.refetch()
        if (selected() && !session.isError && !resources().invalid) void native.refetch()
      },
      inspectHarness: setInspecting,
      cancel: (monitorID: string) =>
        cancel.mutate({ server: props.session.server, sessionID: props.session.id, monitorID }),
    },
  }
}

export type DeliveryMonitors = ReturnType<typeof createDeliveryMonitors>

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { HookStatus } from "@opencode/client/promise"
import { useExtension, type MountedSession, type ServerRef } from "../sdk"
import type { DeliverySection } from "./resources-model"

export type HookAction = "trust" | "revoke" | "import"

export function createDeliveryHooks(props: { session: MountedSession; visible: boolean; section: DeliverySection }) {
  const ctx = useExtension()
  const cache = useQueryClient()
  const query = useQuery(() => {
    const server = props.session.server
    const directory = props.session.directory
    return {
      queryKey: ["delivery-hooks", server.id, directory],
      enabled: props.visible && props.section === "hooks" && server.connected && !!props.session.location,
      queryFn: async ({ signal }) => (await server.client.hook.status({ location: { directory } }, { signal })).data,
      retry: false,
    }
  })
  const change = useMutation(() => ({
    mutationFn: async (input: { server: ServerRef; directory: string; action: HookAction }) => ({
      ...input,
      result:
        input.action === "import"
          ? await input.server.client.hook.import({ location: { directory: input.directory } }, { signal: ctx.signal })
          : await input.server.client.hook[input.action](
              { location: { directory: input.directory } },
              { signal: ctx.signal },
            ),
    }),
    onSuccess: (result) => {
      if (ctx.signal.aborted) return
      const data = result.result.data
      if ("trusted" in data)
        cache.setQueryData<HookStatus>(["delivery-hooks", result.server.id, result.directory], (current) =>
          current
            ? {
                trust: data,
                definitions: current.definitions.map((item) =>
                  item.support === "unsupported" ? item : { ...item, support: data.trusted ? "active" : "untrusted" },
                ),
              }
            : current,
        )
      void cache.invalidateQueries({ queryKey: ["delivery-hooks", result.server.id, result.directory] })
    },
  }))
  const current = () =>
    change.variables?.server.id === props.session.server.id && change.variables.directory === props.session.directory
  return {
    snapshot: () => ({
      status: query.data,
      directory: props.session.directory,
      connected: props.session.server.connected && !!props.session.location,
      loading: query.isPending,
      refreshing: query.isFetching,
      unavailable: query.isError,
      pending: current() && change.isPending,
      failed: current() && change.isError,
      imported:
        current() && change.isSuccess && "imported" in change.data.result.data ? change.data.result.data : undefined,
    }),
    actions: {
      refresh: () => void query.refetch(),
      clear: () => change.reset(),
      run: (action: HookAction) =>
        change.mutateAsync({ server: props.session.server, directory: props.session.directory, action }),
    },
  }
}

export type DeliveryHooks = ReturnType<typeof createDeliveryHooks>

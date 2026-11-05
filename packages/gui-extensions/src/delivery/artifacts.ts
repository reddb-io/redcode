import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { useExtension, type MountedSession, type ServerRef } from "../sdk"
import type { DeliverySection } from "./resources-model"

export function createDeliveryArtifacts(props: {
  session: MountedSession
  visible: boolean
  section: DeliverySection
}) {
  const ctx = useExtension()
  const cache = useQueryClient()
  const enabled = () => props.visible && props.session.server.connected && props.section === "artifacts"
  const query = useQuery(() => ({
    queryKey: ["delivery-artifacts", props.session.server.id, props.session.id],
    enabled: enabled(),
    queryFn: ({ signal }) =>
      props.session.server.client.session.artifact.list({ sessionID: props.session.id }, { signal }),
    retry: false,
    refetchInterval: enabled() ? 5000 : false,
  }))
  const publish = useMutation(() => ({
    mutationFn: (input: {
      server: ServerRef
      sessionID: string
      source: string
      title?: string
      entry: string
      id?: string
      expectedRevision?: string
    }) =>
      input.server.client.session.artifact.publish(
        {
          sessionID: input.sessionID,
          source: input.source,
          title: input.title,
          entry: input.entry,
          id: input.id,
          expectedRevision: input.expectedRevision,
        },
        { signal: ctx.signal },
      ),
    onSuccess: (_value, input) => {
      void cache.invalidateQueries({ queryKey: ["delivery-artifacts", input.server.id, input.sessionID] })
    },
  }))
  const current = () =>
    publish.variables?.server.id === props.session.server.id && publish.variables.sessionID === props.session.id
  return {
    snapshot: () => ({
      items: query.data ?? [],
      loading: query.isPending,
      unavailable: query.isError,
      refreshing: query.isFetching,
      publishing: current() && publish.isPending,
      publishError: current() && publish.isError ? String(publish.error) : undefined,
      connected: props.session.server.connected,
    }),
    actions: {
      refresh: () => void query.refetch(),
      publish: (input: { source: string; title?: string; entry: string; id?: string; expectedRevision?: string }) =>
        publish.mutate({ ...input, server: props.session.server, sessionID: props.session.id }),
      content: (artifactID: string, revisionID: string, file: string) =>
        props.session.server.client.session.artifact.content(
          { sessionID: props.session.id, artifactID, revisionID, file },
          { signal: ctx.signal },
        ),
    },
  }
}

export type DeliveryArtifacts = ReturnType<typeof createDeliveryArtifacts>

import { createMemo } from "solid-js"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createVisitState, useExtension, type MountedSession, type ServerRef } from "../sdk"
import {
  changeResources,
  deliveryResources,
  RESOURCE_KEY,
  type DeliverySection,
  type ResourceChange,
} from "./resources-model"

export function createDeliveryResources(props: {
  session: MountedSession
  visible: boolean
  section: DeliverySection
}) {
  const ctx = useExtension()
  const cache = useQueryClient()
  const [inspecting, setInspecting] = createVisitState("")
  const root = () => props.session.server.data.session.root(props.session.id)
  const enabled = () => props.visible && props.session.server.connected
  const session = useQuery(() => ({
    queryKey: ["delivery-session", props.session.server.id, root()],
    queryFn: ({ signal }) => props.session.server.client.session.get({ sessionID: root() }, { signal }),
    enabled: enabled() && props.section === "resources",
    refetchInterval: enabled() && props.section === "resources" ? 5000 : false,
    retry: false,
  }))
  const harnesses = useQuery(() => ({
    queryKey: ["delivery-harnesses", props.session.server.id],
    queryFn: ({ signal }) => props.session.server.client.harness.list({ signal }),
    enabled: enabled() && props.section === "resources",
    refetchInterval: enabled() && props.section === "resources" ? 5000 : false,
    retry: false,
  }))
  const skills = useQuery(() => ({
    queryKey: ["delivery-skills", props.session.server.id, props.session.directory],
    queryFn: ({ signal }) =>
      props.session.server.client.skill.list({ location: { directory: props.session.directory } }, { signal }),
    enabled: enabled() && props.section === "skills",
    retry: false,
  }))
  const save = useMutation(() => ({
    mutationFn: async (input: { server: ServerRef; sessionID: string; change: ResourceChange }) => {
      const current = await input.server.client.session.get({ sessionID: input.sessionID }, { signal: ctx.signal })
      if (ctx.signal.aborted) return
      const resources = deliveryResources(current.metadata)
      if (resources.invalid) throw new Error(ctx.t("resourcesInvalid"))
      const next = changeResources(resources.value, input.change)
      const metadata = {
        ...current.metadata,
        [RESOURCE_KEY]: {
          version: next.version,
          pullRequests: [...next.pullRequests],
          harnesses: next.harnesses.map((run) => ({ ...run })),
        },
      }
      await input.server.client.session.update({ sessionID: input.sessionID, metadata }, { signal: ctx.signal })
      if (ctx.signal.aborted) return
      return { ...input, session: { ...current, metadata } }
    },
    onSuccess: (result) => {
      if (!result || ctx.signal.aborted) return
      cache.setQueryData(["delivery-session", result.server.id, result.sessionID], result.session)
    },
  }))
  const load = useMutation(() => ({
    mutationFn: (input: { server: ServerRef; sessionID: string; skill: string }) =>
      input.server.client.session.skill(
        { sessionID: input.sessionID, id: input.skill, resume: false },
        { signal: ctx.signal },
      ),
  }))
  const resources = createMemo(() => deliveryResources(session.data?.metadata))
  const selected = () => (resources().value.harnesses.some((run) => run.runID === inspecting()) ? inspecting() : "")
  const detail = useQuery(() => ({
    queryKey: ["delivery-harness-detail", props.session.server.id, selected()],
    queryFn: ({ signal }) => props.session.server.client.harness.read({ runID: selected() }, { signal }),
    enabled: enabled() && props.section === "resources" && !!selected(),
    refetchInterval: enabled() && props.section === "resources" && selected() ? 3000 : false,
    retry: false,
  }))
  const currentSave = () => save.variables?.sessionID === root() && save.variables.server.id === props.session.server.id
  const currentLoad = () =>
    load.variables?.sessionID === props.session.id && load.variables.server.id === props.session.server.id
  return {
    snapshot: () => ({
      section: props.section,
      resources: resources().value,
      invalid: resources().invalid,
      ready: session.isSuccess,
      refreshing:
        props.section === "skills"
          ? skills.isFetching
          : session.isFetching || harnesses.isFetching || detail.isFetching,
      loading: props.section === "resources" ? session.isPending || harnesses.isPending : skills.isPending,
      unavailable: props.section === "resources" ? session.isError || harnesses.isError : skills.isError,
      runs: harnesses.data?.runs ?? [],
      skills: skills.data?.data ?? [],
      saving: currentSave() && save.isPending,
      saveFailed: currentSave() && save.isError,
      loadingSkill: currentLoad() && load.isPending,
      skillFailed: currentLoad() && load.isError,
      loadedSkill: currentLoad() && load.isSuccess ? load.variables?.skill : undefined,
      canLoad: enabled() && props.session.server.data.session.status(props.session.id) !== "running",
      connected: props.session.server.connected,
      inspecting: selected(),
      detail: selected() ? detail.data : undefined,
      detailFailed: !!selected() && detail.isError,
    }),
    actions: {
      change: (change: ResourceChange) => save.mutate({ server: props.session.server, sessionID: root(), change }),
      loadSkill: (skill: string) => load.mutate({ server: props.session.server, sessionID: props.session.id, skill }),
      refresh: () => {
        if (props.section === "skills") return void skills.refetch()
        void Promise.all([session.refetch(), harnesses.refetch(), ...(selected() ? [detail.refetch()] : [])])
      },
      openExternal: (url: string) => ctx.system.openExternal(url),
      inspect: setInspecting,
    },
  }
}

export type DeliveryResources = ReturnType<typeof createDeliveryResources>

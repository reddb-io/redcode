import { createMemo } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { ReactView } from "@opencode/ui/react-view"
import { createVisitState, useExtension, type MountedSession } from "../sdk"
import { DeliveryView } from "./view.react"
import { createDeliveryResources } from "./resources"
import { createDeliveryMonitors } from "./monitors"
import { createDeliveryHooks } from "./hooks"
import { createDeliveryAutomations } from "./automations"
import type { DeliverySection } from "./resources-model"
import en from "./i18n/en"

export default function DeliveryPanel(props: { session: MountedSession; visible: boolean; onReview?: () => void }) {
  const ctx = useExtension()
  const [section, setSection] = createVisitState<DeliverySection>("overview")
  const resources = createDeliveryResources({
    get session() {
      return props.session
    },
    get visible() {
      return props.visible
    },
    get section() {
      return section()
    },
  })
  const root = createMemo(() => props.session.server.data.session.root(props.session.id))
  const monitors = createDeliveryMonitors({
    get session() {
      return props.session
    },
    get visible() {
      return props.visible
    },
    get section() {
      return section()
    },
  })
  const enabled = () => props.visible && props.session.server.connected && section() === "overview"
  const hooks = createDeliveryHooks({
    get session() {
      return props.session
    },
    get visible() {
      return props.visible
    },
    get section() {
      return section()
    },
  })
  const automations = createDeliveryAutomations({
    get session() {
      return props.session
    },
    get visible() {
      return props.visible
    },
    get section() {
      return section()
    },
  })
  const graph = useQuery(() => ({
    queryKey: ["delivery-tasks", props.session.server.id, root()],
    enabled: enabled(),
    queryFn: ({ signal }) => props.session.server.client.session.todo.graph({ sessionID: root() }, { signal }),
    retry: false,
    refetchInterval: enabled() ? 5000 : false,
  }))
  const goal = useQuery(() => ({
    queryKey: ["delivery-goal", props.session.server.id, root()],
    enabled: enabled(),
    queryFn: ({ signal }) => props.session.server.client.session.goal.get({ sessionID: root() }, { signal }),
    retry: false,
    refetchInterval: enabled() ? 5000 : false,
  }))
  const view = createMemo(() => {
    const data = props.session.server.data
    return {
      key: props.session.key,
      root: root(),
      current: props.session.id,
      connected: props.session.server.connected,
      project: props.session.listedProject?.name ?? props.session.project?.name ?? props.session.project?.worktree,
      directory: props.session.directory,
      server: props.session.server.name,
      // Read localized strings here so the renderer observes dictionary changes.
      copy: Object.fromEntries(Object.keys(en).map((key) => [key, ctx.t(key)])),
      goal: goal.data,
      tasks: graph.data?.tasks ?? [],
      nodes: graph.data?.nodes ?? [],
      assignments: graph.data?.assignments ?? [],
      loading: graph.isPending || goal.isPending,
      unavailable: graph.isError || goal.isError,
      refreshing: graph.isFetching || goal.isFetching,
      sessions: data.session.family(root()).flatMap((id) => {
        const session = data.session.get(id)
        if (!session) return []
        const waiting = !!data.session.permission.list(id)?.length || !!data.session.form.list(id)?.length
        return [
          {
            ...session,
            state: waiting
              ? ("waiting" as const)
              : data.session.status(id) === "running"
                ? ("running" as const)
                : (session.outcome ?? ("idle" as const)),
          },
        ]
      }),
    }
  })
  return (
    <ReactView
      component={DeliveryView}
      props={{
        view: view(),
        resources: resources.snapshot(),
        resourceActions: resources.actions,
        monitors: monitors.snapshot(),
        monitorActions: monitors.actions,
        hooks: hooks.snapshot(),
        hookActions: hooks.actions,
        automations: automations.snapshot(),
        automationActions: automations.actions,
        section: setSection,
        refresh: () => {
          if (section() === "automations") return automations.actions.refresh()
          if (section() === "hooks") return hooks.actions.refresh()
          if (section() === "monitors") return monitors.actions.refresh()
          if (section() !== "overview") return resources.actions.refresh()
          void Promise.all([graph.refetch(), goal.refetch()])
        },
        open: (id: string) => {
          const session = props.session.server.data.session.get(id)
          if (session) ctx.sessions.open(props.session.server.id, session)
        },
        review: props.onReview,
      }}
    />
  )
}

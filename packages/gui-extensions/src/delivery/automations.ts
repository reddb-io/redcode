import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { Automation } from "@opencode/schema/automation"
import { createVisitState, useExtension, type MountedSession, type ServerRef } from "../sdk"
import type { DeliverySection } from "./resources-model"

export type AutomationChange =
  | { type: "create"; input: Automation.Input }
  | { type: "control"; id: string; enabled: boolean }
  | { type: "run"; id: string; runID: Automation.RunID }
  | { type: "remove"; id: string }

export function createDeliveryAutomations(props: {
  session: MountedSession
  visible: boolean
  section: DeliverySection
}) {
  const ctx = useExtension()
  const cache = useQueryClient()
  const [selected, setSelected] = createVisitState("")
  const enabled = () => props.visible && props.section === "automations" && props.session.server.connected
  const query = useQuery(() => {
    const server = props.session.server
    const sessionID = props.session.id
    return {
      queryKey: ["delivery-automations", server.id, sessionID],
      queryFn: ({ signal }) => server.client.automation.list({ sessionID }, { signal }),
      enabled: enabled(),
      retry: false,
      refetchInterval: enabled() ? 5000 : false,
    }
  })
  const history = useQuery(() => {
    const server = props.session.server
    const sessionID = props.session.id
    const automationID = selected()
    return {
      queryKey: ["delivery-automation-history", server.id, sessionID, automationID],
      queryFn: ({ signal }) => server.client.automation.history({ sessionID, automationID }, { signal }),
      enabled: enabled() && !!query.data?.some((item) => item.id === automationID),
      retry: false,
      refetchInterval: enabled() && !!automationID ? 5000 : false,
    }
  })
  const change = useMutation(() => ({
    mutationFn: async (input: { server: ServerRef; sessionID: string; change: AutomationChange }) => {
      const client = input.server.client.automation
      const action = input.change
      if (action.type === "create")
        return client.create({ sessionID: input.sessionID, ...action.input }, { signal: ctx.signal })
      if (action.type === "control")
        return client.control(
          { sessionID: input.sessionID, automationID: action.id, enabled: action.enabled },
          { signal: ctx.signal },
        )
      if (action.type === "run")
        return client.run(
          { sessionID: input.sessionID, automationID: action.id, id: action.runID },
          { signal: ctx.signal },
        )
      return client.remove({ sessionID: input.sessionID, automationID: action.id }, { signal: ctx.signal })
    },
    onSettled: (_result, _error, input) => {
      if (ctx.signal.aborted) return
      void cache.invalidateQueries({ queryKey: ["delivery-automations", input.server.id, input.sessionID] })
      void cache.invalidateQueries({ queryKey: ["delivery-automation-history", input.server.id, input.sessionID] })
    },
  }))
  const current = () =>
    change.variables?.server.id === props.session.server.id && change.variables.sessionID === props.session.id
  return {
    snapshot: () => ({
      items: (query.data ?? []).map((item) => ({
        ...item,
        scheduleLabel:
          item.schedule.type === "once"
            ? ctx.t("autoOnce")
            : item.schedule.type === "interval"
              ? ctx.plural("autoEvery", item.schedule.everyMs / 60000)
              : ctx.t("autoCalendarLabel", {
                  time: item.schedule.timeOfDay,
                  zone: item.schedule.timeZone,
                  days: [...new Set(item.schedule.weekdays)]
                    .toSorted((a, b) => a - b)
                    .map((day) => ctx.t(`autoDay.${day}`))
                    .join(", "),
                }),
      })),
      selected: selected(),
      history: history.data ?? [],
      historyFailed: history.isError,
      historyLoading: history.isPending,
      connected: props.session.server.connected,
      loading: query.isPending,
      unavailable: query.isError,
      refreshing: query.isFetching,
      pending: current() && change.isPending,
      failed: current() && change.isError,
    }),
    actions: {
      select: setSelected,
      clear: () => change.reset(),
      refresh: () => {
        void query.refetch()
        if (selected()) void history.refetch()
      },
      change: (action: AutomationChange) =>
        change.mutateAsync({ server: props.session.server, sessionID: props.session.id, change: action }),
    },
  }
}
export type DeliveryAutomations = ReturnType<typeof createDeliveryAutomations>

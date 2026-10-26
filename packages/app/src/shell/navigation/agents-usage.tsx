import { useQuery } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { AgentUsageView } from "./agents-usage.react"

export default function AgentUsage(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const context = useGlobal().ensureServerCtx(props.server)
  const host = ServerConnection.key(props.server)
  const [state, setState] = createStore({ days: 7, project: "", to: Date.now() })
  const connected = () => context.sdk.connection.status() === "connected"
  const projects = useQuery(() => ({
    queryKey: ["usage-projects", host],
    enabled: connected(),
    queryFn: ({ signal }) => context.sdk.api.project.list({}, { signal }),
    retry: false,
  }))
  const stats = useQuery(() => ({
    queryKey: ["usage-daily", host, state.project, state.days, state.to],
    enabled: connected(),
    queryFn: ({ signal }) => {
      const from = new Date(state.to)
      from.setDate(from.getDate() - state.days + 1)
      from.setHours(0, 0, 0, 0)
      return context.sdk.api.session.stats(
        {
          from: from.getTime(),
          to: state.to,
          project: state.project || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          tools: "summary",
          series: "daily",
        },
        { signal },
      )
    },
    retry: false,
  }))
  const services = {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      connected: connected(),
      days: state.days,
      project: state.project,
      projects: projects.data ?? [],
      projectsError: projects.isError,
      data: stats.data,
      loading: stats.isPending,
      error: stats.isError,
    })),
    selectDays: (days: number) => setState({ days, to: Date.now() }),
    selectProject: (project: string) => setState({ project, to: Date.now() }),
    refresh: () => {
      setState("to", Date.now())
      void projects.refetch()
    },
  }
  return <ReactView component={AgentUsageView} props={{ services }} />
}

import { useSearchParams } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useNavigation } from "./controller"

import { AGENT_VIEWS, type AgentView } from "./agents-menu-model"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { AgentsMenuView } from "./agents-menu.react"

export { AGENT_VIEWS, AGENT_LABELS } from "./agents-menu-model"
export type { AgentView } from "./agents-menu-model"

export function useAgentsScope() {
  const [params, setParams] = useSearchParams()
  const servers = useServers()
  const view = (): AgentView =>
    params.view === "machines" || params.view === "remote"
      ? "servers"
      : (AGENT_VIEWS.find((view) => view === params.view) ?? "sessions")
  const host = () =>
    typeof params.host === "string" && params.host
      ? params.host
      : view() === "servers" && servers.visible[0]
        ? ServerConnection.key(servers.visible[0])
        : ""
  return {
    view,
    select: (view: AgentView) => setParams({ view, host: host() || undefined, setup: undefined }),
    host,
    selectHost: (host: string) => setParams({ host: host || undefined }),
    servers: () => servers.visible.filter((server) => !host() || ServerConnection.key(server) === host()),
  }
}

export function AgentsMenu() {
  const language = useLanguage()
  const navigation = useNavigation()
  const servers = useServers()
  const scope = useAgentsScope()
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    view: scope.view(),
    host: scope.host(),
    servers: servers.visible.map((server) => ({
      value: ServerConnection.key(server),
      label: serverName(server),
      description: server.http.url,
    })),
  }))
  return (
    <ReactView
      component={AgentsMenuView}
      props={{
        source,
        selectHost: scope.selectHost,
        select: (view: AgentView) => {
          scope.select(view)
          if (navigation.mobile()) navigation.panel.close()
        },
      }}
    />
  )
}

import { useSearchParams } from "@solidjs/router"
import { sidebarNavigation } from "@reddb-io/design-system/contracts/sidebar-navigation"
import { navItem } from "@reddb-io/design-system/contracts/nav-item"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { SearchSelect } from "@opencode/ui/search-select"
import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useNavigation } from "./controller"

const AGENT_GROUPS = [
  { label: "agents.group.execution", views: ["sessions", "inbox", "harness", "remote"] },
  { label: "agents.group.workspaces", views: ["project-environments", "environments", "worktrees"] },
  { label: "agents.group.infrastructure", views: ["machines", "hosts"] },
] as const
export const AGENT_VIEWS = AGENT_GROUPS.flatMap((group) => [...group.views])
export type AgentView = (typeof AGENT_VIEWS)[number]
export const AGENT_LABELS = {
  sessions: "agents.sessions",
  inbox: "agents.inbox.title",
  harness: "harness.title",
  machines: "agentMachines.title",
  "project-environments": "projectEnvironments.title",
  environments: "environments.title",
  worktrees: "agentWorktrees.title",
  hosts: "agents.hosts.title",
  remote: "remoteWorkers.title",
} as const

export function useAgentsScope() {
  const [params, setParams] = useSearchParams()
  const servers = useServers()
  const view = (): AgentView => AGENT_VIEWS.find((view) => view === params.view) ?? "sessions"
  const host = () =>
    typeof params.host === "string" && params.host
      ? params.host
      : view() === "machines" && servers.visible[0]
        ? ServerConnection.key(servers.visible[0])
        : ""
  return {
    view,
    select: (view: AgentView) => setParams({ view }),
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
  const nav = sidebarNavigation()
  return (
    <nav
      aria-label={language.t("agents.title")}
      data-component="agents-sidemenu"
      class={nav.root({ class: "h-full min-h-0 border-0 bg-transparent shadow-none p-2" })}
    >
      <h2 class="px-2 py-3 text-13-medium leading-[var(--line-height-base)]">{language.t("agents.title")}</h2>
      <label class="flex flex-col gap-1 px-2 pb-4 text-13-regular leading-[var(--line-height-base)]">
        {language.t("agents.scope.host")}
        <SearchSelect
          label={language.t("agents.scope.host")}
          value={scope.host()}
          onChange={scope.selectHost}
          options={[
            ...(scope.view() === "machines" ? [] : [{ value: "", label: language.t("agents.scope.all") }]),
            ...servers.visible.map((server) => ({
              value: ServerConnection.key(server),
              label: serverName(server),
              description: server.http.url,
            })),
          ]}
        />
      </label>
      <For each={AGENT_GROUPS}>
        {(group) => (
          <section class="mb-[var(--reddb-spatial-layout-gap-sm)]">
            <h3 class="px-2 pb-2 text-caption font-medium text-ink-muted">{language.t(group.label)}</h3>
            <ul aria-label={language.t(group.label)} class={nav.list()}>
              <For each={group.views}>
                {(view) => (
                  <li>
                    <button
                      type="button"
                      aria-current={scope.view() === view ? "page" : undefined}
                      class={quietControl({
                        focus: "inset",
                        class: navItem({ current: scope.view() === view }).root(),
                      })}
                      onClick={() => {
                        scope.select(view)
                        if (navigation.mobile()) navigation.panel.close()
                      }}
                    >
                      <span class={navItem().label()}>{language.t(AGENT_LABELS[view])}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </nav>
  )
}

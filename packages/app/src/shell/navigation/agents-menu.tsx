import { useSearchParams } from "@solidjs/router"
import { sidebarNavigation } from "@reddb-io/design-system/contracts/sidebar-navigation"
import { navItem } from "@reddb-io/design-system/contracts/nav-item"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { input } from "@reddb-io/design-system/contracts/input"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useNavigation } from "./controller"

export const AGENT_VIEWS = [
  "sessions",
  "inbox",
  "harness",
  "machines",
  "environments",
  "worktrees",
  "hosts",
  "remote",
] as const
export type AgentView = (typeof AGENT_VIEWS)[number]
export const AGENT_LABELS = {
  sessions: "agents.sessions",
  inbox: "agents.inbox.title",
  harness: "harness.title",
  machines: "agentMachines.title",
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
        <select
          aria-label={language.t("agents.scope.host")}
          class={input({ size: "sm" })}
          value={scope.host()}
          onChange={(event) => scope.selectHost(event.currentTarget.value)}
        >
          <Show when={scope.view() !== "machines"}>
            <option value="">{language.t("agents.scope.all")}</option>
          </Show>
          <For each={servers.visible}>
            {(server) => <option value={ServerConnection.key(server)}>{serverName(server)}</option>}
          </For>
        </select>
      </label>
      <ul class={nav.list()}>
        <For each={AGENT_VIEWS}>
          {(view) => (
            <li>
              <button
                type="button"
                aria-current={scope.view() === view ? "page" : undefined}
                class={quietControl({ focus: "inset", class: navItem({ current: scope.view() === view }).root() })}
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
    </nav>
  )
}

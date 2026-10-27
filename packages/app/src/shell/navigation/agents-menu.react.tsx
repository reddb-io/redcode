/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { NavItem } from "@reddb-io/design-system/app/NavItem"
import { SearchSelect } from "@reddb-io/design-system/base/SearchSelect"
import { sidebarNavigation } from "@reddb-io/design-system/app/recipes"
import type { SearchSelectOption } from "@reddb-io/design-system/base/recipes"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import { AGENT_GROUPS, AGENT_LABELS, type AgentView } from "./agents-menu-model"

export function AgentsMenuView(props: {
  source: SharedSource<{
    language: SharedLanguage
    view: AgentView
    host: string
    servers: SearchSelectOption[]
  }>
  selectHost: (host: string) => void
  select: (view: AgentView) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const nav = sidebarNavigation()
  return (
    <nav
      aria-label={language.t("agents.title")}
      data-component="agents-sidemenu"
      className={nav.root({ class: "h-full min-h-0 border-0 bg-transparent shadow-none p-2" })}
    >
      <h2 className="px-2 py-3 text-13-medium leading-[var(--line-height-base)]">{language.t("agents.title")}</h2>
      <SearchSelect
        label={language.t("infrastructure.serverFilter")}
        value={view.host}
        onValueChange={props.selectHost}
        controlSize="sm"
        clearable={false}
        className="px-2 pb-4"
        triggerClass="min-h-[var(--reddb-spatial-target-min)]"
        placeholder={language.t("agents.scope.all")}
        searchPlaceholder={language.t("ui.searchSelect.search")}
        emptyText={language.t("ui.searchSelect.empty")}
        options={[
          ...(view.view === "servers" ? [] : [{ value: "", label: language.t("agents.scope.all") }]),
          ...view.servers,
        ]}
      />
      {AGENT_GROUPS.map((group) => (
        <section key={group.label} className="mb-[var(--reddb-spatial-layout-gap-sm)]">
          <h3 className="px-2 pb-2 text-caption font-medium text-ink-muted">{language.t(group.label)}</h3>
          <ul aria-label={language.t(group.label)} className={nav.list()}>
            {group.views.map((item) => (
              <li key={item}>
                <NavItem
                  label={language.t(AGENT_LABELS[item])}
                  current={view.view === item}
                  onClick={() => props.select(item)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

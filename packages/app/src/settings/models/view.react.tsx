/** @jsxImportSource react */
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import fuzzysort from "fuzzysort"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { IntegrationOrder } from "@opencode/util/integration-order"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { SettingsList, SettingsRow } from "../shared.react"
import { SettingsSearchField } from "../search-field.react"
import { SettingsSearchEmpty } from "../search-empty.react"
import { SettingsIcon } from "../icon.react"
import { OpenCodeLogo, ProviderModelIcon } from "../providers/provider-icon.react"
import { ReasoningRoles } from "./reasoning.react"
import type { createModelsServices, SettingsModel } from "./models"

const consoleKey = "console:opencode"
type Services = ReturnType<typeof createModelsServices>
export function Models(props: { services: Services }) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = state.language
  const [filter, setFilter] = useState("")
  const sections = useRef(new Map<string, HTMLElement>())
  const managed = consoleProviderGroup([
    ...new Map(state.models.map((item) => [item.provider.id, item.provider])).values(),
  ])
  const groups = useMemo(() => {
    const found = filter
      ? fuzzysort
          .go(filter.toLowerCase(), state.models, { keys: ["provider.name", "name", "id"] })
          .map((item) => item.obj)
      : state.models
    const groups = new Map<string, SettingsModel[]>()
    found.forEach((item) => groups.set(item.provider.id, [...(groups.get(item.provider.id) ?? []), item]))
    return Array.from(groups, ([category, items]) => ({
      category,
      items: items.toSorted((a, b) => a.name.localeCompare(b.name)),
    })).sort(
      (a, b) =>
        IntegrationOrder.providerRank(a.category) - IntegrationOrder.providerRank(b.category) ||
        a.items[0].provider.name.localeCompare(b.items[0].provider.name),
    )
  }, [state.models, filter])
  const expanded = (key: string) => !!filter || !state.collapsed[key]
  useLayoutEffect(() => {
    if (!state.active || !state.provider) return
    if (filter) {
      setFilter("")
      return
    }
    const provider = state.provider
    if (!groups.some((group) => group.category === provider)) return
    if (managed?.providers.some((item) => item.id === provider) && state.collapsed[consoleKey]) {
      services.expand(consoleKey, true)
      return
    }
    const section = sections.current.get(provider)
    if (!section?.isConnected) return
    services.expand(provider, true)
    const frame = requestAnimationFrame(() => {
      const panel = section.closest<HTMLElement>(".settings-panel")
      const header = panel?.querySelector<HTMLElement>(".settings-tab-header")
      if (panel && header)
        panel.scrollTo({
          top: panel.scrollTop + section.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 24,
        })
      if (!panel || !header) section.scrollIntoView({ block: "start" })
      section
        .querySelector<HTMLElement>(".provider-model-group-trigger, .settings-models-group-trigger")
        ?.focus({ preventScroll: true })
      services.reveal()
    })
    return () => cancelAnimationFrame(frame)
  }, [state.active, state.provider, groups, filter, state.collapsed])
  const rows = (items: SettingsModel[]) => (
    <SettingsList variant="catalog">
      {items.map((item) => (
        <SettingsRow key={`${item.provider.id}:${item.id}`} title={item.name} description="">
          {(association) => (
            <Switch
              {...association}
              label={item.name}
              fieldClass="settings-react-switch"
              checked={item.visible}
              onCheckedChange={(value) => services.visible(item.provider.id, item.id, value)}
            />
          )}
        </SettingsRow>
      ))}
    </SettingsList>
  )
  const provider = (group: (typeof groups)[number], nested = false) => {
    const item = group.items[0].provider
    const name =
      nested && managed
        ? consoleProviderName(managed, item.name)
        : group.category === "opencode" && group.items.every((item) => !item.cost?.input)
          ? language.t("provider.connect.opencode.freeName")
          : item.name
    return (
      <section
        key={group.category}
        ref={(element) => {
          if (element) sections.current.set(group.category, element)
          else sections.current.delete(group.category)
        }}
        className={nested ? "provider-model-group" : "settings-section"}
        data-component={nested ? "provider-model-group" : "settings-models-provider"}
        data-provider={nested ? group.category : undefined}
        data-expanded={expanded(group.category) ? "" : undefined}
      >
        <h3 className={nested ? "provider-model-group-header" : "settings-models-group-header"}>
          <button
            type="button"
            className={nested ? "provider-model-group-trigger" : "settings-models-group-trigger"}
            aria-expanded={expanded(group.category)}
            disabled={!!filter}
            onClick={() => services.expand(group.category, !expanded(group.category))}
          >
            {!nested && (
              <span className="settings-models-group-chevron">
                <SettingsIcon
                  name="chevron-down"
                  size="small"
                  className={!expanded(group.category) ? "collapsed" : undefined}
                />
              </span>
            )}
            <span className={nested ? "provider-model-group-label" : "settings-models-group-label"}>
              <ProviderModelIcon provider={item} className="shrink-0" />
              <bdi className={nested ? "provider-model-group-title" : "settings-models-group-title"}>{name}</bdi>
              {nested && (
                <SettingsIcon
                  name="chevron-down"
                  size="small"
                  className={`provider-model-group-chevron${!expanded(group.category) ? " collapsed" : ""}`}
                />
              )}
            </span>
          </button>
          {nested && (
            <div className="provider-model-group-actions">
              <DropdownMenu
                triggerLabel={language.t("common.moreOptions")}
                contentLabel={language.t("common.moreOptions")}
                trigger={<SettingsIcon name="outline-dots" />}
                variant="ghost"
                size="sm"
                align="end"
                items={[
                  {
                    id: "enable",
                    label: language.t("settings.models.enableAll"),
                    onselect: () =>
                      state.models
                        .filter((item) => item.provider.id === group.category)
                        .forEach((item) => services.visible(item.provider.id, item.id, true)),
                  },
                  {
                    id: "disable",
                    label: language.t("settings.models.disableAll"),
                    onselect: () =>
                      state.models
                        .filter((item) => item.provider.id === group.category)
                        .forEach((item) => services.visible(item.provider.id, item.id, false)),
                  },
                ]}
              />
            </div>
          )}
        </h3>
        {expanded(group.category) &&
          (nested ? <div className="provider-model-group-models">{rows(group.items)}</div> : rows(group.items))}
      </section>
    )
  }
  const managedIds = new Set(managed?.providers.map((provider) => provider.id))
  const firstManaged = groups.findIndex((group) => managedIds.has(group.category))
  return (
    <>
      <div className="settings-tab-header settings-tab-header--stacked">
        <div className="settings-tab-header-row">
          <div className="flex flex-col gap-1">
            <h2 className="settings-tab-title">{language.t("settings.models.title")}</h2>
            <span className="text-11-regular text-ink-muted">{language.t("settings.models.description")}</span>
          </div>
        </div>
        <SettingsSearchField
          value={filter}
          active={state.active}
          onInput={setFilter}
          placeholder={language.t("dialog.model.search.placeholder")}
          language={language}
        />
      </div>
      <div className="settings-tab-body settings-models">
        {!filter && <ReasoningRoles services={services.reasoning} />}
        {!groups.length ? (
          filter ? (
            <div className="settings-tab-search-empty">
              <SettingsSearchEmpty query={filter} language={language} />
            </div>
          ) : (
            <div className="settings-models-status">{language.t("dialog.model.empty")}</div>
          )
        ) : (
          groups.map((group, index) => {
            if (!managed || !managedIds.has(group.category)) return provider(group)
            if (index !== firstManaged) return null
            return (
              <section
                key={consoleKey}
                className="settings-section"
                data-component="settings-models-console"
                data-expanded={expanded(consoleKey) ? "" : undefined}
              >
                <h3 className="settings-models-group-header">
                  <button
                    type="button"
                    className="settings-models-group-trigger"
                    aria-expanded={expanded(consoleKey)}
                    disabled={!!filter}
                    onClick={() => services.expand(consoleKey, !expanded(consoleKey))}
                  >
                    <span className="settings-models-group-chevron">
                      <SettingsIcon
                        name="chevron-down"
                        size="small"
                        className={!expanded(consoleKey) ? "collapsed" : undefined}
                      />
                    </span>
                    <span className="settings-models-group-label">
                      <OpenCodeLogo className="size-4 shrink-0" />
                      <bdi className="settings-models-group-title">{language.t("provider.connect.opencode.name")}</bdi>
                      <span>{managed.workspace}</span>
                    </span>
                  </button>
                </h3>
                {expanded(consoleKey) && (
                  <div className="provider-model-groups settings-models-console-groups">
                    {groups.filter((group) => managedIds.has(group.category)).map((group) => provider(group, true))}
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>
    </>
  )
}

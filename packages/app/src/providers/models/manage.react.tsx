/** @jsxImportSource react */
import { useMemo, useState, useSyncExternalStore } from "react"
import fuzzysort from "fuzzysort"
import { IntegrationOrder } from "@opencode/util/integration-order"
import { Button } from "@reddb-io/design-system/base/Button"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import { Icon } from "@/runtime/react/icon.react"
import { SettingsList, SettingsRow } from "@/settings/shared.react"
import { SettingsSearchInput } from "@/settings/search-input.react"
import { OpenCodeLogo, ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import type { createModelVisibilityServices } from "./manage"

type Services = ReturnType<typeof createModelVisibilityServices>
const consoleKey = "console:opencode"

export function ManageModelsDialog(props: { services: Services }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const [search, setSearch] = useState("")
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const managed = consoleProviderGroup([
    ...new Map(view.models.map((item) => [item.provider.id, item.provider])).values(),
  ])
  const groups = useMemo(() => {
    const found = search
      ? fuzzysort
          .go(search.toLowerCase(), view.models, { keys: ["provider.name", "name", "id"] })
          .map((result) => result.obj)
      : view.models
    const grouped = new Map<string, typeof view.models>()
    found.forEach((item) => grouped.set(item.provider.id, [...(grouped.get(item.provider.id) ?? []), item]))
    return Array.from(grouped, ([category, items]) => ({
      category,
      items: items.toSorted((a, b) => a.name.localeCompare(b.name)),
    })).sort(
      (a, b) =>
        IntegrationOrder.providerRank(a.category) - IntegrationOrder.providerRank(b.category) ||
        a.items[0].provider.name.localeCompare(b.items[0].provider.name),
    )
  }, [search, view.models])
  const expanded = (key: string) => !!search || !collapsed[key]
  const toggle = (key: string) => setCollapsed((value) => ({ ...value, [key]: !value[key] }))
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
        className={nested ? "provider-model-group" : "settings-section"}
        data-component={nested ? "provider-model-group" : "settings-models-provider"}
        data-provider={nested ? group.category : undefined}
        data-expanded={expanded(group.category) ? "" : undefined}
      >
        <h3 className={nested ? "provider-model-group-header" : "settings-models-group-header justify-between"}>
          <Button
            variant="ghost"
            className={nested ? "provider-model-group-trigger" : "settings-models-group-trigger"}
            aria-expanded={expanded(group.category)}
            disabled={!!search}
            onClick={() => toggle(group.category)}
          >
            {!nested && (
              <span className="settings-models-group-chevron">
                <Icon
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
                <Icon
                  name="chevron-down"
                  size="small"
                  className={`provider-model-group-chevron ${!expanded(group.category) ? "collapsed" : ""}`}
                />
              )}
            </span>
          </Button>
          {nested ? (
            <div className="provider-model-group-actions">
              <DropdownMenu
                triggerLabel={language.t("common.moreOptions")}
                contentLabel={name}
                variant="ghost"
                size="sm"
                align="end"
                trigger={<Icon name="outline-dots" />}
                items={[
                  {
                    id: "enable",
                    label: language.t("settings.models.enableAll"),
                    onselect: () => services.provider(group.category, true),
                  },
                  {
                    id: "disable",
                    label: language.t("settings.models.disableAll"),
                    onselect: () => services.provider(group.category, false),
                  },
                ]}
              />
            </div>
          ) : (
            <Switch
              label={item.name}
              fieldClass="settings-react-switch me-6"
              checked={view.models.filter((item) => item.provider.id === group.category).every((item) => item.visible)}
              onCheckedChange={(checked) => services.provider(group.category, checked)}
            />
          )}
        </h3>
        {expanded(group.category) && (
          <div className={nested ? "provider-model-group-models" : undefined}>
            <SettingsList variant="catalog">
              {group.items.map((item) => (
                <SettingsRow key={item.id} title={item.name} description="">
                  {(association) => (
                    <Switch
                      {...association}
                      label={item.name}
                      fieldClass="settings-react-switch"
                      checked={item.visible}
                      onCheckedChange={(checked) => services.visible(item.provider.id, item.id, checked)}
                    />
                  )}
                </SettingsRow>
              ))}
            </SettingsList>
          </div>
        )}
      </section>
    )
  }
  const managedIDs = new Set(managed?.providers.map((item) => item.id))
  const firstManaged = groups.findIndex((group) => managedIDs.has(group.category))
  return (
    <Dialog
      open={view.open}
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
      size="lg"
      showClose={false}
      className="settings-manage-models-dialog h-[min(640px,calc(100dvh-32px))] [&_[data-dialog-body]]:flex [&_[data-dialog-body]]:flex-col [&_[data-dialog-body]]:overflow-hidden"
      onOpenChange={(open) => {
        if (!open) services.close()
      }}
      header={() => (
        <>
          <DialogHeader title={language.t("dialog.model.manage")} language={language} close={services.close} />
          <Button onClick={services.connect}>
            <Icon name="plus" />
            {language.t("command.provider.connect")}
          </Button>
        </>
      )}
    >
      <SettingsSearchInput
        value={search}
        autoFocus
        onValueChange={setSearch}
        placeholder={language.t("dialog.model.search.placeholder")}
        aria-label={language.t("dialog.model.search.placeholder")}
        clearLabel={language.t("common.clear")}
        onClear={() => setSearch("")}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          services.close()
        }}
      />
      <ScrollArea
        variant="plain"
        label={language.t("dialog.model.manage")}
        data-slot="manage-models-scroll"
        className="settings-panel settings-models min-h-0 flex-1 pt-1 pb-4"
      >
        {!groups.length ? (
          <div role="status" className="settings-models-status">
            <span>{language.t("dialog.model.empty")}</span>
            {search && <span className="settings-models-status-filter">&quot;{search}&quot;</span>}
          </div>
        ) : (
          groups.map((group, index) => {
            if (!managed || !managedIDs.has(group.category)) return provider(group)
            if (index !== firstManaged) return null
            return (
              <section
                key={consoleKey}
                className="settings-section"
                data-component="settings-models-console"
                data-expanded={expanded(consoleKey) ? "" : undefined}
              >
                <h3 className="settings-models-group-header">
                  <Button
                    variant="ghost"
                    className="settings-models-group-trigger"
                    disabled={!!search}
                    aria-expanded={expanded(consoleKey)}
                    onClick={() => toggle(consoleKey)}
                  >
                    <span className="settings-models-group-chevron">
                      <Icon
                        name="chevron-down"
                        size="small"
                        className={!expanded(consoleKey) ? "collapsed" : undefined}
                      />
                    </span>
                    <span className="settings-models-group-label">
                      <OpenCodeLogo className="size-4 shrink-0" />
                      <bdi className="settings-models-group-title">{language.t("provider.connect.opencode.name")}</bdi>
                      <Badge>{managed.workspace}</Badge>
                    </span>
                  </Button>
                </h3>
                {expanded(consoleKey) && (
                  <div className="provider-model-groups settings-models-console-groups">
                    {groups.filter((group) => managedIDs.has(group.category)).map((group) => provider(group, true))}
                  </div>
                )}
              </section>
            )
          })
        )}
      </ScrollArea>
    </Dialog>
  )
}

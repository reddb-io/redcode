/** @jsxImportSource react */
import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Select } from "@reddb-io/design-system/base/Select"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { SettingsHeader, SettingsList, type SettingsLanguage } from "../shared.react"
import { SettingsIcon } from "../icon.react"
import { OpenCodeLogo, ProviderModelIcon } from "./provider-icon.react"
import { createProviderSettingsController } from "./controller"
import { activeProviderAccount, providerAccounts } from "./accounts"
import { RemoveProviderDialog } from "./remove-dialog.react"
import type { ProviderSettingsServices, ProviderItem } from "./providers"

type Controller = ReturnType<typeof createProviderSettingsController>
export function Providers(props: { services: ProviderSettingsServices }) {
  const snapshot = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const [controller] = useState(() => createProviderSettingsController(props.services))
  const state = useSyncExternalStore(controller.source.subscribe, controller.source.getSnapshot)
  useEffect(() => controller.reconcile(), [snapshot, state.disconnecting])
  const language = snapshot.language
  const group = controller.consoleGroup()
  return (
    <>
      <SettingsHeader
        title={language.t("settings.providers.title")}
        description={language.t("settings.providers.description")}
      />
      <div className="settings-tab-body settings-tab-body--sectioned settings-providers">
        <div className="settings-section" data-component="connected-providers-section">
          <h3 className="settings-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList variant="catalog">
            {!controller.displayed().length ? (
              <div className="settings-provider-empty">{language.t("settings.providers.connected.empty")}</div>
            ) : (
              controller.displayed().map((item) =>
                group?.root.id === item.id ? (
                  <div key={item.id} className="settings-provider-console group">
                    <div className="settings-provider-console-header">
                      <div className="settings-provider-lead">
                        <OpenCodeLogo className="settings-provider-icon size-4 shrink-0" />
                        <div className="settings-provider-console-summary">
                          <div className="settings-provider-main">
                            <span className="settings-provider-name truncate">
                              {language.t("provider.connect.opencode.name")}
                            </span>
                            <Badge>{group.workspace}</Badge>
                          </div>
                          {group.providers.length > 1 && (
                            <button
                              type="button"
                              className="settings-provider-console-toggle"
                              aria-expanded={state.consoleExpanded}
                              onClick={() => controller.update({ consoleExpanded: !state.consoleExpanded })}
                            >
                              <span>
                                {language.plural("settings.providers.console.available", group.providers.length, {
                                  count: group.providers.length,
                                })}
                              </span>
                              <SettingsIcon
                                name="chevron-right"
                                size="small"
                                className={`settings-provider-console-chevron${state.consoleExpanded ? " open" : ""}`}
                              />
                            </button>
                          )}
                        </div>
                      </div>
                      {controller.canManageAccounts(item) ? (
                        <AccountMenu
                          provider={item}
                          name={language.t("provider.connect.opencode.name")}
                          controller={controller}
                          language={language}
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void controller.disconnect(item, language.t("provider.connect.opencode.name"))}
                        >
                          {language.t("common.disconnect")}
                        </Button>
                      )}
                    </div>
                    {state.consoleExpanded && (
                      <div className="settings-provider-console-list">
                        <div className="settings-provider-console-separator" aria-hidden="true" />
                        {group.providers.map((provider) => (
                          <button
                            key={provider.id}
                            type="button"
                            className="settings-provider-console-item"
                            onClick={() => props.services.select(provider.id)}
                          >
                            <span>{provider.name.slice(group.prefix.length)}</span>
                            <SettingsIcon
                              name="chevron-right"
                              size="small"
                              className="settings-provider-console-item-chevron"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={item.id} className="settings-provider-row group">
                    <div className="settings-provider-lead">
                      <ProviderModelIcon provider={item} className="settings-provider-icon shrink-0" />
                      <div className="settings-provider-main">
                        <span className="settings-provider-name truncate">{item.name}</span>
                        <Badge>{controller.type(item)}</Badge>
                        {controller.keyRole(item) && <Badge>{controller.keyRole(item)}</Badge>}
                      </div>
                    </div>
                    {controller.canManageAccounts(item) ? (
                      <AccountMenu provider={item} controller={controller} language={language} />
                    ) : controller.canDisconnect(item) ? (
                      <Button size="sm" variant="ghost" onClick={() => void controller.disconnect(item, item.name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    ) : (
                      <span className="settings-provider-env-hint">
                        {language.t("settings.providers.connected.environmentDescription")}
                      </span>
                    )}
                    {!controller.canManageAccounts(item) && (
                      <>
                        {controller.integration(item)?.metadata?.source !== "mcp" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={language.t("provider.manage.title", { provider: item.name })}
                            onClick={() => controller.manage(item, item.name)}
                          >
                            {language.t("provider.manage.check")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={language.t("settings.providers.remove.title", { provider: item.name })}
                          onClick={() => void controller.removeProvider(item, item.name)}
                        >
                          {language.t("settings.providers.remove.action")}
                        </Button>
                      </>
                    )}
                  </div>
                ),
              )
            )}
          </SettingsList>
        </div>
        <div className="settings-section">
          <h3 className="settings-section-title">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList variant="catalog">
            {controller.popular().map((item) => {
              const note = controller.note(item.id)
              return (
                <div key={item.id} className="settings-provider-row">
                  <div className="settings-provider-lead">
                    <ProviderModelIcon provider={item} className="settings-provider-icon shrink-0" />
                    <div className="settings-provider-copy">
                      <div className="settings-provider-main">
                        <span className="settings-provider-name">{item.name}</span>
                        {item.id === "red-router" && <Badge>{language.t("dialog.provider.tag.recommended")}</Badge>}
                      </div>
                      {note && <p className="settings-provider-description">{language.t(note)}</p>}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => controller.connect(item.id)}>
                    <SettingsIcon name="plus" />
                    {language.t("common.connect")}
                  </Button>
                </div>
              )
            })}
          </SettingsList>
          <button type="button" className="settings-providers-view-all" onClick={() => controller.connect()}>
            {language.t("dialog.provider.viewAll")}
          </button>
        </div>
      </div>
      {state.removal && (
        <RemoveProviderDialog
          name={state.removal.name}
          preview={state.removal.preview}
          language={language}
          onRemove={controller.confirmRemoval}
          onClose={() => controller.update({ removal: undefined })}
        />
      )}
    </>
  )
}
function AccountMenu(props: {
  provider: ProviderItem
  name?: string
  controller: Controller
  language: SettingsLanguage
}) {
  const language = props.language
  const controller = props.controller
  const accounts = providerAccounts(controller.integration(props.provider))
  const active = activeProviderAccount(controller.integration(props.provider))
  const name = props.name ?? props.provider.name
  const busy = controller.source.getSnapshot().credentialID !== undefined
  return (
    <div className="settings-provider-account-trigger flex items-center gap-1">
      <Select
        aria-label={language.t("settings.providers.account.manage", { provider: name })}
        controlSize="sm"
        value={active?.id ?? ""}
        disabled={busy}
        options={accounts.map((account) => ({ value: account.id, label: account.label }))}
        onValueChange={(id) => {
          const account = accounts.find((account) => account.id === id)
          if (account) void controller.activate(props.provider, name, account)
        }}
      />
      <DropdownMenu
        triggerLabel={language.t("settings.providers.account.manage", { provider: name })}
        contentLabel={language.t("settings.providers.account.manage", { provider: name })}
        trigger={<SettingsIcon name="chevron-down" size="small" />}
        variant="ghost"
        size="sm"
        align="end"
        className="settings-provider-account-menu"
        items={[
          {
            items: [
              {
                id: "manage",
                label: language.t("settings.providers.account.manageConnections"),
                disabled: busy,
                onselect: () => controller.manage(props.provider, name),
              },
              {
                id: "add",
                label: language.t("settings.providers.account.add"),
                disabled: busy,
                onselect: () => controller.connect(props.provider.id),
              },
            ],
          },
          {
            heading: language.t("settings.providers.account.remove"),
            items: accounts.map((account) => ({
              id: `remove:${account.id}`,
              label: account.label,
              disabled: busy,
              onselect: () => void controller.remove(props.provider, name, account),
            })),
          },
          {
            items: [
              {
                id: "remove",
                label: language.t("settings.providers.remove.action"),
                disabled: busy,
                onselect: () => void controller.removeProvider(props.provider, name),
              },
            ],
          },
        ]}
      />
    </div>
  )
}

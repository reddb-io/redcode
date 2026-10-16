import { Button } from "@opencode/ui/button"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, Show, type Component } from "solid-js"
import { ServerRowMenu } from "@/servers/registry/row-menu"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ExtensionServerRow } from "@/servers/registry/extension-row"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useServerCollectionController } from "@/servers/registry/controller"
import { DialogServer } from "@/servers/connect/dialog"
import { DialogShareServer } from "@/servers/connect/share-dialog"
import { DialogHttpsAccess } from "@/servers/connect/https-dialog"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { ShellSetting } from "@/settings/general/general"
import { createServerShellController } from "@/settings/general/controllers"
import type { SettingsServer } from "./inventory"
import "@/settings/settings.css"

export const SettingsServerGeneral: Component<{
  entry: SettingsServer
  nested?: boolean
  onAddServer?: () => void
  onServerChange?: (server: ServerConnection.Any) => void
}> = (props) => {
  const navigate = useNavigate()
  const dialog = useDialog()
  const language = useLanguage()
  const controller = useServerCollectionController()
  const health = createMemo(() => controller.collection.health()[props.entry.key])

  const edit = (server: ServerConnection.Http) =>
    void dialog.push(() => <DialogServer mode="edit" server={server} onSave={props.onServerChange} />)

  // An HTTP server that rejects its saved credentials signs in again through the edit dialog.
  const signedOut = (server: ServerConnection.Any) =>
    server.type === "http" && health()?.unauthorized ? server : undefined

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">
              {props.nested ? props.entry.name : language.t("settings.section.server")}
            </h2>
            <span class="text-11-regular text-ink-muted">
              {language.t(props.nested ? "settings.server.description" : "settings.servers.description")}
            </span>
          </div>
          <Show when={!props.nested && props.onAddServer}>
            <AddServerMenu onAddServer={() => props.onAddServer?.()} />
          </Show>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section settings-server-connection" data-component="settings-server-connection">
          <h3 class="settings-section-title">{language.t("settings.server.section.connection")}</h3>
          <SettingsList>
            <Show
              when={props.entry.source?.entry.row ? props.entry.key : undefined}
              keyed
              fallback={
                <Show when={props.entry.connection}>
                  {(server) => (
                    <div class="settings-servers-row">
                      <div class="settings-servers-lead">
                        <ServerHealthIndicator health={health()} authenticationRequired={!!health()?.unauthorized} />
                        <div class="settings-servers-copy">
                          <bdi class="settings-servers-name" dir="auto">
                            {serverName(server()) || props.entry.key}
                          </bdi>
                          <bdi class="settings-servers-meta" dir="ltr">
                            {server().http.url}
                          </bdi>
                        </div>
                      </div>
                      <div class="settings-servers-actions">
                        <Show when={signedOut(server())}>
                          {(http) => (
                            <Button size="small" variant="neutral" onClick={() => edit(http())}>
                              {language.t("server.action.authenticate")}
                            </Button>
                          )}
                        </Show>
                        <ServerRowMenu server={server()} domain={controller} onEdit={edit} />
                      </div>
                    </div>
                  )}
                </Show>
              }
            >
              {(key) => <ExtensionServerRow server={key} controller={controller} />}
            </Show>
          </SettingsList>
        </section>
        <Show when={props.entry.connection}>
          <section class="settings-section">
            <h3 class="settings-section-title">{language.t("agents.title")}</h3>
            <div class="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => navigate(`/agents?view=harness&host=${encodeURIComponent(props.entry.key)}`)}
              >
                {language.t("harness.title")}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/agents?view=machines&host=${encodeURIComponent(props.entry.key)}`)}
              >
                {language.t("agentMachines.title")}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/agents?view=worktrees&host=${encodeURIComponent(props.entry.key)}`)}
              >
                {language.t("agentWorktrees.title")}
              </Button>
            </div>
          </section>
        </Show>

        <Show when={props.entry.connection} keyed>
          {(server) => (
            <>
              <section class="settings-section">
                <h3 class="settings-section-title">{language.t("server.share.section")}</h3>
                <SettingsList>
                  <SettingsRow
                    title={language.t("server.share.title")}
                    description={language.t("server.share.rowDescription")}
                  >
                    <div data-action="settings-server-pairing">
                      <Button
                        variant="neutral"
                        disabled={!!health()?.unauthorized}
                        onClick={() => void dialog.push(() => <DialogShareServer server={server} />)}
                      >
                        {language.t("server.share.open")}
                      </Button>
                    </div>
                  </SettingsRow>
                  <SettingsRow title={language.t("https.title")} description={language.t("https.description")}>
                    <Button
                      variant="outline"
                      disabled={!!health()?.unauthorized}
                      onClick={() => void dialog.push(() => <DialogHttpsAccess server={server} />)}
                    >
                      {language.t("https.configure")}
                    </Button>
                  </SettingsRow>
                </SettingsList>
              </section>
              <ServerShell server={server} />
            </>
          )}
        </Show>
      </div>
    </>
  )
}

function ServerShell(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const controller = createServerShellController(() => props.server)

  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.tab.preferences")}</h3>
      <SettingsList>
        <ShellSetting controller={controller} />
      </SettingsList>
    </section>
  )
}

/** @jsxImportSource react */
import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Select } from "@reddb-io/design-system/base/Select"
import { SharedSlot } from "@/runtime/react/slot.react"
import { SettingsList, SettingsRow } from "../shared.react"
import { createShellOptions } from "../general/behavior"
import type { createServerGeneralServices } from "./servers"

type Services = ReturnType<typeof createServerGeneralServices>
export function ServerGeneral(props: { services: Services }) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = state.language
  return (
    <>
      <div className="settings-tab-header">
        <div className="settings-tab-header-row">
          <div className="flex flex-col gap-1">
            <h2 className="settings-tab-title">{state.nested ? state.name : language.t("settings.section.server")}</h2>
            <span className="text-11-regular text-ink-muted">
              {language.t(state.nested ? "settings.server.description" : "settings.servers.description")}
            </span>
          </div>
          {state.add && <SharedSlot mount={services.add} />}
        </div>
      </div>
      <div className="settings-tab-body settings-tab-body--sectioned">
        <section className="settings-section settings-server-connection" data-component="settings-server-connection">
          <h3 className="settings-section-title">{language.t("settings.server.section.connection")}</h3>
          <SettingsList>
            {state.contributed ? (
              <SharedSlot mount={services.contributed} />
            ) : (
              state.connection && (
                <div className="settings-servers-row">
                  <div className="settings-servers-lead">
                    <SharedSlot mount={services.health} />
                    <div className="settings-servers-copy">
                      <bdi className="settings-servers-name" dir="auto">
                        {state.connection.name}
                      </bdi>
                      <bdi className="settings-servers-meta" dir="ltr">
                        {state.connection.url}
                      </bdi>
                    </div>
                  </div>
                  <div className="settings-servers-actions">
                    {state.signedOut && (
                      <Button size="sm" onClick={services.authenticate}>
                        {language.t("server.action.authenticate")}
                      </Button>
                    )}
                    <SharedSlot mount={services.menu} />
                  </div>
                </div>
              )
            )}
          </SettingsList>
        </section>
        {state.connection && (
          <>
            <section className="settings-section">
              <h3 className="settings-section-title">{language.t("agents.title")}</h3>
              <div className="flex flex-wrap gap-2">
                {(["harness", "machines", "worktrees"] as const).map((view) => (
                  <Button key={view} variant="secondary" size="sm" onClick={() => services.agents(view)}>
                    {language.t(
                      view === "harness"
                        ? "harness.title"
                        : view === "machines"
                          ? "agentMachines.title"
                          : "agentWorktrees.title",
                    )}
                  </Button>
                ))}
              </div>
            </section>
            <section className="settings-section">
              <h3 className="settings-section-title">{language.t("server.share.section")}</h3>
              <SettingsList>
                <SettingsRow
                  title={language.t("server.share.title")}
                  description={language.t("server.share.rowDescription")}
                >
                  {(association) => (
                    <div data-action="settings-server-pairing">
                      <Button
                        {...association}
                        aria-labelledby={undefined}
                        size="sm"
                        disabled={state.unauthorized}
                        onClick={services.share}
                      >
                        {language.t("server.share.open")}
                      </Button>
                    </div>
                  )}
                </SettingsRow>
                <SettingsRow title={language.t("https.title")} description={language.t("https.description")}>
                  {(association) => (
                    <Button
                      {...association}
                      aria-labelledby={undefined}
                      size="sm"
                      variant="secondary"
                      disabled={state.unauthorized}
                      onClick={services.https}
                    >
                      {language.t("https.configure")}
                    </Button>
                  )}
                </SettingsRow>
              </SettingsList>
            </section>
            <ServerShell key={state.key} services={services} language={language} />
          </>
        )}
      </div>
    </>
  )
}
function ServerShell(props: {
  services: Services
  language: ReturnType<Services["snapshot"]["getSnapshot"]>["language"]
}) {
  const [state, setState] = useState<Awaited<ReturnType<Services["shells"]>>>({ shells: [], shell: "" })
  useEffect(() => {
    const owner = { active: true }
    void props.services.shells().then((value) => {
      if (owner.active) setState(value)
    })
    return () => {
      owner.active = false
    }
  }, [props.services])
  const options = createShellOptions({ shells: state.shells, current: state.shell })
  const language = props.language
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{language.t("settings.tab.preferences")}</h3>
      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.shell.title")}
          description={language.t("settings.general.row.shell.description")}
        >
          {(association) => (
            <Select
              {...association}
              data-action="settings-shell"
              controlSize="sm"
              value={state.shell}
              options={options.map((option) => ({
                value: option.value,
                label:
                  option.id === "auto"
                    ? language.t("settings.general.row.shell.autoDefault")
                    : option.terminalOnly
                      ? `${option.name} (${language.t("settings.general.row.shell.terminalOnly")})`
                      : option.name,
              }))}
              onValueChange={(value) => {
                if (value === state.shell) return
                const previous = state
                setState({ ...state, shell: value })
                void props.services.setShell(value).catch((error) => {
                  setState(previous)
                  props.services.failure(error)
                })
              }}
            />
          )}
        </SettingsRow>
      </SettingsList>
    </section>
  )
}

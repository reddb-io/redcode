/** @jsxImportSource react */
import type { LSPStatus } from "@opencode/client/promise"
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { Tabs } from "@reddb-io/design-system/base/Tabs"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { Button } from "@reddb-io/design-system/base/Button"
import { Disclosure } from "@reddb-io/design-system/base/Disclosure"
import { pluginLabels } from "@/providers/catalog/plugin"
import { SettingsHeader, SettingsList, type SettingsLanguage } from "../shared.react"
import { SettingsIcon } from "../icon.react"
import { configuredLanguageServers } from "../workspaces/project-lsp"
import type { createExtensionsServices, ExtensionsSnapshot } from "./extensions"
import "../workspaces/project.css"

type Services = ReturnType<typeof createExtensionsServices>
const tabs = ["mcps", "plugins", "skills", "lsps"] as const
const skillKey = (item: { name: string; path: string }) => `${item.name}\n${item.path}`
export function Extensions(props: { services: Services }) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = state.language
  const [plugins, setPlugins] = useState<{ global: string[]; project: string[] }>({ global: [], project: [] })
  useEffect(() => {
    if (!state.connected) return
    const owner = { active: true }
    void services.load()
    void Promise.all([
      state.api.plugin.list().then((result) => pluginLabels(result.data)),
      state.directory
        ? state.api.plugin
            .list({ location: { directory: state.directory } })
            .then((result) => pluginLabels(result.data))
        : Promise.resolve([]),
    ])
      .then(([global, project]) => {
        if (owner.active) setPlugins({ global, project })
      })
      .catch(() => undefined)
    return () => {
      owner.active = false
    }
  }, [state.api, state.connected, state.directory, services])
  const project = !!state.directory
  const mcps = project
    ? state.mcps
        .filter((item) => !state.globalMcps.includes(item.name))
        .toSorted((a, b) => a.name.localeCompare(b.name))
    : state.mcps
  const globalMcps = [...new Set(state.globalMcps)].sort()
  const skills = project
    ? state.skills.filter((item) => !state.globalSkills.some((shared) => skillKey(shared) === skillKey(item)))
    : state.skills
  const localPlugins = project ? plugins.project.filter((name) => !plugins.global.includes(name)) : plugins.global
  const mcpRows = (items: { name: string; enabled: boolean }[]) =>
    items.map((item) => (
      <ExtensionRow key={item.name} icon="mcp" name={item.name} project={project}>
        <Switch
          label={item.name}
          fieldClass="settings-react-switch"
          checked={item.enabled}
          disabled={state.pending && (!project || state.pendingName === item.name)}
          onCheckedChange={(checked) => {
            if (item.enabled !== checked && !state.pending) services.toggle(item.name)
          }}
        />
      </ExtensionRow>
    ))
  const pluginRows = (items: string[]) =>
    items.map((name) => <ExtensionRow key={name} icon="cube" name={name} project={project} />)
  const skillRows = (items: { name: string; path: string }[]) =>
    items.map((item) => <ExtensionRow key={skillKey(item)} icon="post-skill" name={item.name} project={project} />)
  return (
    <>
      <SettingsHeader
        title={language.t("settings.tab.extensions")}
        description={language.t(
          project ? "project.settings.extensions.description" : "settings.extensions.description",
        )}
      />
      <div className="settings-tab-body">
        <Tabs
          label={language.t("settings.tab.extensions")}
          value={state.subtab}
          onValueChange={(value) => {
            if (value === "mcps" || value === "plugins" || value === "skills" || (project && value === "lsps"))
              services.select(value)
          }}
          items={tabs
            .filter((value) => project || value !== "lsps")
            .map((value) => ({
              value,
              label: language.t(
                value === "lsps" ? "project.settings.extensions.tab.lsps" : `settings.extensions.tab.${value}`,
              ),
            }))}
          className={`${project ? "project-settings-extension-tabs" : "settings-extensions-tabs"} settings-subtabs`}
        >
          {(item) =>
            item.value !== state.subtab ? null : item.value === "lsps" ? (
              <LanguageServers state={state} services={services} />
            ) : (
              <div className={project ? "project-settings-extension-section" : "settings-section"}>
                {project ? (
                  <ProjectSectionHeader
                    kind={item.value as "mcps" | "plugins" | "skills"}
                    language={language}
                    empty={!(item.value === "mcps" ? mcps : item.value === "plugins" ? localPlugins : skills).length}
                    action={
                      item.value === "skills" ? (
                        <SkillsLink language={language} />
                      ) : (
                        <span>{language.t("settings.extensions.manageConfig")}</span>
                      )
                    }
                  />
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="settings-extension-heading text-13-medium">
                      {language.t("settings.extensions.availableAll")}
                    </span>
                    {item.value === "skills" ? (
                      <SkillsLink language={language} />
                    ) : (
                      <span className="text-13-regular text-ink-muted">
                        {language.t("settings.extensions.manageConfig")}
                      </span>
                    )}
                  </div>
                )}
                {(!project ||
                  (item.value === "mcps" ? mcps : item.value === "plugins" ? localPlugins : skills).length > 0) && (
                  <SettingsList variant="catalog">
                    {item.value === "mcps"
                      ? mcpRows(mcps)
                      : item.value === "plugins"
                        ? pluginRows(localPlugins)
                        : skillRows(skills)}
                  </SettingsList>
                )}
                {project && (
                  <SharedSection
                    language={language}
                    count={
                      (item.value === "mcps"
                        ? globalMcps
                        : item.value === "plugins"
                          ? plugins.global
                          : state.globalSkills
                      ).length
                    }
                  >
                    {item.value === "mcps"
                      ? mcpRows(
                          globalMcps.map((name) => ({
                            name,
                            enabled: state.mcps.some((item) => item.name === name && item.enabled),
                          })),
                        )
                      : item.value === "plugins"
                        ? pluginRows(plugins.global)
                        : skillRows(state.globalSkills)}
                  </SharedSection>
                )}
              </div>
            )
          }
        </Tabs>
      </div>
    </>
  )
}
function SkillsLink(props: { language: SettingsLanguage }) {
  return (
    <a
      className="text-text-strong underline settings-extension-link text-13-regular"
      href="https://opencode.ai/docs/skills/"
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.language.t("settings.extensions.addSkills")}
    </a>
  )
}
function ExtensionRow(props: {
  icon: string
  name: string
  description?: ReactNode
  children?: ReactNode
  project?: boolean
}) {
  return (
    <div className={`settings-extension-row${props.project ? " project-settings-extension-row" : ""}`}>
      <div className="settings-extension-lead">
        <SettingsIcon
          name={props.icon}
          className={props.project ? "project-settings-extension-row-icon" : "text-ink-muted shrink-0"}
        />
        <div className="project-settings-extension-row-copy">
          <span className="project-settings-extension-row-name settings-extension-name">{props.name}</span>
          {props.description && <span className="project-settings-extension-row-description">{props.description}</span>}
        </div>
      </div>
      {props.children}
    </div>
  )
}
function ProjectSectionHeader(props: {
  kind: "mcps" | "plugins" | "skills"
  empty: boolean
  language: SettingsLanguage
  action: ReactNode
}) {
  return (
    <div className="project-settings-extension-section-header">
      <div className="project-settings-extension-section-copy">
        <span>
          {props.language.t(
            props.empty ? `project.settings.extensions.empty.${props.kind}.title` : "project.settings.extensions.added",
          )}
        </span>
        {props.empty && (
          <span className="project-settings-extension-empty-description">
            {props.language.t(`project.settings.extensions.empty.${props.kind}.description`)}
          </span>
        )}
      </div>
      {props.action}
    </div>
  )
}
function SharedSection(props: { count: number; children: ReactNode; language: SettingsLanguage }) {
  const [open, setOpen] = useState(false)
  return (
    props.count > 0 && (
      <div className="project-settings-shared">
        <Disclosure
          label={`${props.language.t("project.settings.extensions.shared")} ${props.count}`}
          open={open}
          onOpenChange={setOpen}
          triggerClass="settings-models-group-trigger project-settings-shared-trigger"
        >
          <SettingsList variant="catalog">{props.children}</SettingsList>
        </Disclosure>
      </div>
    )
  )
}
function LanguageServers(props: { state: ExtensionsSnapshot; services: Services }) {
  const state = props.state
  const language = state.language
  const [config, setConfig] = useState<ReturnType<typeof configuredLanguageServers>>()
  const [statuses, setStatuses] = useState<LSPStatus[]>([])
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setConfig(undefined)
    setStatuses([])
    setPending(true)
    if (!state.connected) return
    const owner = { active: true }
    const load = () => {
      setPending(true)
      void Promise.all([
        state.api.config.get({ location: { directory: state.directory } }),
        state.api.lsp.status({ location: { directory: state.directory } }),
      ]).then(
        ([value, runtime]) => {
          if (!owner.active) return
          setConfig(configuredLanguageServers(value))
          setStatuses(runtime.data)
          setError(false)
          setPending(false)
        },
        () => {
          if (owner.active) {
            setError(true)
            setPending(false)
          }
        },
      )
    }
    load()
    const unsubscribe = props.services.onConfigUpdate(load)
    return () => {
      owner.active = false
      unsubscribe()
    }
  }, [state.api, state.directory, state.connected, props.services, revision])
  const empty = !pending && !error && !config?.servers.length
  return (
    <div className="project-settings-extension-section">
      <div className="project-settings-extension-section-header">
        <div className="project-settings-extension-section-copy">
          <span>
            {language.t(
              empty
                ? config?.disabled
                  ? "project.settings.extensions.lsp.disabled.title"
                  : "project.settings.extensions.lsp.empty.title"
                : "project.settings.extensions.lsp.configured",
            )}
          </span>
          {empty && (
            <span className="project-settings-extension-empty-description">
              {language.t(
                config?.disabled
                  ? "project.settings.extensions.lsp.disabled.description"
                  : "project.settings.extensions.lsp.empty.description",
              )}
            </span>
          )}
        </div>
        <span>{language.t("project.settings.extensions.lsp.description")}</span>
      </div>
      {pending ? (
        <p className="project-settings-extension-empty-description">{language.t("common.loading")}</p>
      ) : error ? (
        <div className="project-settings-extension-section-copy" role="status">
          <span className="project-settings-extension-empty-description">
            {language.t("project.settings.extensions.lsp.status.loadFailed")}
          </span>
          <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>
            {language.t("project.settings.extensions.lsp.retry")}
          </Button>
        </div>
      ) : (
        !!config?.servers.length && (
          <SettingsList variant="catalog">
            {config.servers.map((item) => (
              <ExtensionRow
                key={item.name}
                icon="code"
                name={item.name}
                project
                description={item.extensions.length ? <bdi dir="ltr">{item.extensions.join(", ")}</bdi> : undefined}
              >
                <span className="project-settings-extension-row-status">
                  {language.t(
                    item.disabled
                      ? "project.settings.extensions.lsp.status.disabled"
                      : "project.settings.extensions.lsp.status.enabled",
                  )}
                </span>
              </ExtensionRow>
            ))}
          </SettingsList>
        )
      )}
      {!pending && !error && statuses.length > 0 && (
        <section aria-label={language.t("project.settings.extensions.lsp.runtime")}>
          <div className="project-settings-extension-section-header">
            {language.t("project.settings.extensions.lsp.runtime")}
          </div>
          <SettingsList variant="catalog">
            {statuses.map((item) => (
              <ExtensionRow
                key={`${item.id}:${item.root}`}
                icon="code"
                name={item.id}
                project
                description={
                  <bdi dir="ltr">
                    {item.root}
                    {item.error ? `: ${item.error}` : ""}
                  </bdi>
                }
              >
                <span className="project-settings-extension-row-status">
                  {language.t(
                    item.status === "connected"
                      ? "project.settings.extensions.lsp.connected"
                      : "project.settings.extensions.lsp.error",
                  )}
                </span>
              </ExtensionRow>
            ))}
          </SettingsList>
        </section>
      )}
    </div>
  )
}

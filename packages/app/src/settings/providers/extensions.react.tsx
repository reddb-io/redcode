/** @jsxImportSource react */
import type { LSPStatus, PluginInfo } from "@opencode/client/promise"
import type { Installed } from "@opencode/gui-extensions/sdk/bridge"
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { Tabs } from "@reddb-io/design-system/base/Tabs"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { Button } from "@reddb-io/design-system/base/Button"
import { Disclosure } from "@reddb-io/design-system/base/Disclosure"
import { pluginLabel } from "@/providers/catalog/plugin"
import { SettingsHeader, SettingsList, type SettingsLanguage } from "../shared.react"
import { SettingsIcon } from "../icon.react"
import { configuredLanguageServers } from "../workspaces/project-lsp"
import type { createExtensionsServices, ExtensionsSnapshot } from "./extensions"
import type { createAgentToolsServices } from "../agent-tools/agent-tools"
import { AgentToolsSettings } from "../agent-tools/view.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import "../workspaces/project.css"

type Services = ReturnType<typeof createExtensionsServices>
const tabs = ["mcps", "plugins", "skills", "tools", "lsps"] as const
const skillKey = (item: { name: string; path: string }) => `${item.name}\n${item.path}`
const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
export function Extensions(props: { services: Services; tools?: ReturnType<typeof createAgentToolsServices> }) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = state.language
  const [pluginBusy, setPluginBusy] = useState(false)
  const [pluginError, setPluginError] = useState("")
  const checkPlugins = () => {
    if (pluginBusy) return
    setPluginBusy(true)
    setPluginError("")
    void services
      .checkPlugins()
      .catch((error) => setPluginError(failureMessage(error)))
      .finally(() => setPluginBusy(false))
  }
  useEffect(() => {
    if (!state.connected) return
    void services.load()
    return services.onPluginUpdate(() => undefined)
  }, [state.connected, state.directory, services])
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
  const globalPlugins = state.plugins.filter((plugin) => plugin.source.type !== "builtin")
  const globalPluginNames = new Set(globalPlugins.map(pluginLabel))
  const localPlugins = project
    ? state.projectPlugins.filter(
        (plugin) => plugin.source.type !== "builtin" && !globalPluginNames.has(pluginLabel(plugin)),
      )
    : globalPlugins
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
  const pluginRows = (items: PluginInfo[], scoped = project) =>
    items.map((plugin) => (
      <PluginRow
        key={pluginLabel(plugin)}
        plugin={plugin}
        project={project}
        language={language}
        update={() =>
          plugin.source.type === "package" ? services.updatePlugin(plugin.source.target, scoped) : Promise.resolve()
        }
      />
    ))
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
      {pluginError ? (
        <p className="mx-4 mt-2 whitespace-pre-wrap text-12-regular text-text-danger-base" role="alert">
          {pluginError}
        </p>
      ) : null}
      <div className="settings-tab-body">
        <Tabs
          label={language.t("settings.tab.extensions")}
          value={state.subtab}
          onValueChange={(value) => {
            if (
              value === "mcps" ||
              value === "plugins" ||
              value === "skills" ||
              (!project && props.tools && value === "tools") ||
              (project && value === "lsps")
            )
              services.select(value)
          }}
          items={tabs
            .filter((value) => (project ? value !== "tools" : value !== "lsps" && (value !== "tools" || !!props.tools)))
            .map((value) => ({
              value,
              label: language.t(
                value === "lsps" ? "project.settings.extensions.tab.lsps" : `settings.extensions.tab.${value}`,
              ),
            }))}
          className={`${project ? "project-settings-extension-tabs" : "settings-extensions-tabs"} settings-subtabs`}
        >
          {(item) =>
            item.value !== state.subtab ? null : item.value === "tools" ? (
              props.tools ? (
                <AgentToolsSettings source={props.tools} />
              ) : null
            ) : item.value === "lsps" ? (
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
                      ) : item.value === "plugins" ? (
                        <Button variant="ghost" disabled={pluginBusy} onClick={checkPlugins}>
                          {language.t("settings.extensions.plugins.check")}
                        </Button>
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
                    ) : item.value === "plugins" ? (
                      <Button variant="ghost" disabled={pluginBusy} onClick={checkPlugins}>
                        {language.t("settings.extensions.plugins.check")}
                      </Button>
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
                          ? globalPlugins
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
                        ? pluginRows(globalPlugins, false)
                        : skillRows(state.globalSkills)}
                  </SharedSection>
                )}
                {!project && item.value === "plugins" && state.desktopExtensions.length > 0 ? (
                  <DesktopExtensions
                    items={state.desktopExtensions}
                    packaged={state.desktopPackaged}
                    services={services}
                    language={language}
                  />
                ) : null}
                {item.value === "plugins" ? <SharedSlot mount={services.pluginSections} /> : null}
              </div>
            )
          }
        </Tabs>
      </div>
    </>
  )
}
function PluginRow(props: {
  plugin: PluginInfo
  project: boolean
  language: SettingsLanguage
  update: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const plugin = props.plugin
  const source =
    plugin.source.type === "package"
      ? [plugin.source.target, plugin.source.version].filter(Boolean).join(" · ")
      : plugin.source.type === "local"
        ? plugin.source.path
        : plugin.source.type
  const features = [
    plugin.features.server ? props.language.t("settings.extensions.plugins.feature.server") : undefined,
    plugin.features.tui ? "TUI" : undefined,
    plugin.features.rpc ? "RPC" : undefined,
  ].filter(Boolean)
  const description = (
    <span className="flex flex-col gap-0.5">
      <span>{[source, ...features].join(" · ")}</span>
      {plugin.state.status === "failed" ? (
        <span className="text-text-danger-base whitespace-pre-wrap">{plugin.state.error}</span>
      ) : null}
      {error ? <span className="text-text-danger-base whitespace-pre-wrap">{error}</span> : null}
    </span>
  )
  const update = () => {
    if (busy) return
    setBusy(true)
    setError("")
    void props
      .update()
      .catch((cause) => setError(failureMessage(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <ExtensionRow icon="cube" name={pluginLabel(plugin)} project={props.project} description={description}>
      <div className="flex items-center gap-2">
        <span className="text-11-regular text-ink-muted">
          {plugin.state.status === "failed"
            ? props.language.t("settings.extensions.plugins.failed")
            : plugin.source.type === "package" && plugin.source.updating
              ? props.language.t("settings.extensions.plugins.updating")
              : props.language.t("settings.extensions.plugins.active")}
        </span>
        {plugin.source.type === "package" && plugin.source.outdated ? (
          <Button variant="ghost" disabled={busy || !!plugin.source.updating} onClick={update}>
            {props.language.t("settings.extensions.plugins.update")}
          </Button>
        ) : null}
      </div>
    </ExtensionRow>
  )
}
function DesktopExtensions(props: {
  items: readonly Installed[]
  packaged: boolean
  services: Services
  language: SettingsLanguage
}) {
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const run = (id: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(id)
    setError("")
    void action()
      .catch((cause) => setError(failureMessage(cause)))
      .finally(() => setBusy(""))
  }
  return (
    <section className="project-settings-shared" aria-label={props.language.t("settings.extensions.desktop.title")}>
      <div className="project-settings-extension-section-header">
        <div className="project-settings-extension-section-copy">
          <span>{props.language.t("settings.extensions.desktop.title")}</span>
          <span className="project-settings-extension-empty-description">
            {props.language.t("settings.extensions.desktop.description")}
          </span>
        </div>
      </div>
      {error ? (
        <p className="whitespace-pre-wrap text-12-regular text-text-danger-base" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsList variant="catalog">
        {props.items.map((item) => (
          <ExtensionRow
            key={item.id}
            icon="desktop"
            name={item.name}
            description={
              <span className="flex flex-col gap-0.5">
                <span>
                  {item.id} · {item.version}
                  {item.builtin ? ` · ${props.language.t("settings.extensions.desktop.builtin")}` : ""}
                </span>
                {item.error ? <span className="text-text-danger-base whitespace-pre-wrap">{item.error}</span> : null}
              </span>
            }
          >
            <div className="flex items-center gap-2">
              {!props.packaged ? (
                <Button
                  variant="ghost"
                  disabled={busy === item.id}
                  onClick={() => run(item.id, () => props.services.reloadDesktopExtension(item.id))}
                >
                  {props.language.t("settings.extensions.desktop.reload")}
                </Button>
              ) : null}
              <Switch
                label={item.name}
                fieldClass="settings-react-switch"
                checked={item.enabled}
                disabled={busy === item.id}
                onCheckedChange={(enabled) => run(item.id, () => props.services.setDesktopExtension(item.id, enabled))}
              />
            </div>
          </ExtensionRow>
        ))}
      </SettingsList>
    </section>
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
            props.empty
              ? props.kind === "plugins"
                ? "settings.extensions.plugins.runtime.empty.title"
                : `project.settings.extensions.empty.${props.kind}.title`
              : "project.settings.extensions.added",
          )}
        </span>
        {props.empty && (
          <span className="project-settings-extension-empty-description">
            {props.language.t(
              props.kind === "plugins"
                ? "settings.extensions.plugins.runtime.empty.description"
                : `project.settings.extensions.empty.${props.kind}.description`,
            )}
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

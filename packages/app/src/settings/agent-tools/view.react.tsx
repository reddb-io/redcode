/** @jsxImportSource react */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { AgentTools } from "@opencode/schema/agent-tools"
import { ExecutionCapability } from "@opencode/schema/execution-capability"
import { Schema } from "effect"
import { card } from "@reddb-io/design-system/contracts/card"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Checkbox } from "@reddb-io/design-system/base/Checkbox"
import { Switch } from "@reddb-io/design-system/base/Switch"
import type { createAgentToolsServices } from "./agent-tools"
import type { SettingsLanguage } from "../shared.react"
import { formatServerError } from "@/runtime/server/errors"

type Operation = "install" | "configure" | "probe" | "initialize" | "extension-prepare" | "extension-install"

export function AgentToolsSettings(props: { source: ReturnType<typeof createAgentToolsServices> }) {
  const services = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = services.language
  const sdk = services
  const controller = useMemo(() => new AbortController(), [services.api, services.connected])
  const [state, updateState] = useState({ busy: "", operation: "install" as Operation, error: "", success: "" })
  const [snapshot, setSnapshot] = useState<AgentTools.Snapshot>()
  const [unavailable, setUnavailable] = useState(false)
  const appearance = card({ padding: "md" })
  const refetch = () => {
    if (!services.connected) return
    return sdk.api.agentTools
      .list({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setSnapshot(Schema.decodeUnknownSync(AgentTools.Snapshot)(result))
        setUnavailable(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true)
      })
  }
  useEffect(() => {
    void refetch()
    return () => controller.abort()
  }, [controller])
  const run = async (id: AgentTools.ID, operation: Operation, action: () => Promise<unknown>) => {
    if (state.busy) return
    updateState({ busy: id, operation, error: "", success: "" })
    try {
      const result = await action()
      if (controller.signal.aborted) return
      if (operation === "initialize") {
        updateState((previous) => ({ ...previous, success: language.t("agentTools.initialized") }))
        return
      }
      const item = Schema.decodeUnknownSync(AgentTools.Status)(result)
      if (item.browserExtension?.error)
        updateState((previous) => ({ ...previous, error: item.browserExtension!.error! }))
      setSnapshot((current) =>
        current ? { ...current, tools: current.tools.map((tool) => (tool.id === item.id ? item : tool)) } : current,
      )
      await refetch()
    } catch (error) {
      if (!controller.signal.aborted)
        updateState((previous) => ({ ...previous, error: formatServerError(error, undefined, language.t("agentTools.failed")) }))
    } finally {
      if (!controller.signal.aborted) updateState((previous) => ({ ...previous, busy: "" }))
    }
  }
  return (
    <>
      <div className="settings-section">
        <p className="text-13-regular text-ink-muted">{language.t("agentTools.description")}</p>
        {unavailable ? (
          <>
            <p role="alert">{language.t("agentTools.unavailable")}</p>
          </>
        ) : null}
        {state.error ? (
          <>
            <p role="alert">{state.error}</p>
          </>
        ) : null}
        {state.success ? (
          <>
            <p role="status">{state.success}</p>
          </>
        ) : null}
        {((value) =>
          value ? (
            <>
              <section className={appearance.root()} aria-label={language.t("agentTools.setup.title")}>
                <div className={appearance.header()}>
                  <h3 className={appearance.title()}>{language.t("agentTools.setup.title")}</h3>
                  <p className={appearance.description()}>{language.t("agentTools.host", value.host)}</p>
                </div>
                <div className={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
                  <p className="text-13-regular">{language.t("agentTools.setup.target", { name: value.host.name })}</p>
                  <ol className="list-decimal pl-5 flex flex-col gap-2 text-13-regular">
                    <li>{language.t("agentTools.setup.install")}</li>
                    <li>{language.t("agentTools.setup.prepare")}</li>
                    <li>{language.t("agentTools.setup.enable")}</li>
                  </ol>
                </div>
              </section>
              <CapabilityOverview
                language={language}
                capabilities={value.capabilities ?? []}
                appearance={appearance}
              />
              <Button variant="secondary" size="sm" disabled={!!state.busy} onClick={() => void refetch()}>
                {language.t("agentTools.refresh")}
              </Button>
              {(value.tools ?? []).map((item) => (
                <AgentToolCard
                  key={item.id}
                  language={language}
                  item={item}
                  busy={!!state.busy}
                  working={state.busy === item.id}
                  operation={state.operation}
                  operationError={state.error}
                  configure={(settings) =>
                    run(item.id, "configure", () =>
                      sdk.api.agentTools.configure({ id: item.id, settings }, { signal: controller.signal }),
                    )
                  }
                  install={() =>
                    run(item.id, "install", () =>
                      sdk.api.agentTools.install({ id: item.id }, { signal: controller.signal }),
                    )
                  }
                  probe={() =>
                    run(item.id, "probe", () =>
                      sdk.api.agentTools.probe({ id: item.id }, { signal: controller.signal }),
                    )
                  }
                  initialize={(directory) =>
                    run(item.id, "initialize", () =>
                      sdk.api.agentTools.initialize({ directory }, { signal: controller.signal }),
                    )
                  }
                  extension={(action) =>
                    run(item.id, action === "install" ? "extension-install" : "extension-prepare", () =>
                      sdk.api.agentTools.browserExtension({ action }, { signal: controller.signal }),
                    )
                  }
                />
              ))}
            </>
          ) : null)(snapshot)}
      </div>
    </>
  )
}

function CapabilityOverview(props: {
  language: SettingsLanguage
  capabilities: ReadonlyArray<ExecutionCapability.Info>
  appearance: ReturnType<typeof card>
}) {
  const ready = props.capabilities.filter((item) => item.status === "ready").length
  const available = props.capabilities.filter((item) => item.status === "available").length
  const groups = (["browser", "desktop", "terminal", "workspace", "other"] as const)
    .map((kind) => ({ kind, items: props.capabilities.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length)
  return (
    <section className={props.appearance.root()} aria-label={props.language.t("agentTools.capabilities.title")}>
      <div className={props.appearance.header()}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={props.appearance.title()}>{props.language.t("agentTools.capabilities.title")}</h3>
          <span className="text-12-regular text-ink-muted tabular-nums">
            {props.language.t("agentTools.capabilities.summary", {
              ready,
              available,
              total: props.capabilities.length,
            })}
          </span>
        </div>
        <p className={props.appearance.description()}>{props.language.t("agentTools.capabilities.description")}</p>
      </div>
      <div className={props.appearance.body({ class: "flex flex-col gap-0 space-y-0" })}>
        {groups.length ? (
          groups.map((group) => (
            <div key={group.kind} className="border-b border-border-weak-base py-2.5 last:border-b-0">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-12-medium">
                  {props.language.t(`agentTools.capabilities.kind.${group.kind}`)}
                </span>
                <span className="text-11-regular text-ink-muted tabular-nums">
                  {props.language.t("agentTools.capabilities.providers", { count: group.items.length })}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 pl-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-13-medium truncate">{item.name}</span>
                        {item.provider?.type === "plugin" ? (
                          <span className="text-11-regular text-ink-muted">
                            {props.language.t("agentTools.capabilities.plugin", {
                              name: item.provider.name ?? item.provider.id,
                            })}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-12-regular text-ink-muted truncate">
                        {props.language.t("agentTools.capabilities.target", {
                          name: item.target.name,
                          type: props.language.t(`agentTools.capabilities.target.${item.target.type}`),
                        })}
                      </p>
                      <p className="text-11-regular text-ink-muted truncate">
                        {item.operations.join(" · ")}
                        {item.sessionID
                          ? ` · ${props.language.t("agentTools.capabilities.session", { session: item.sessionID })}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 text-right">
                      <span className="text-12-medium">
                        {props.language.t(`agentTools.capabilities.status.${item.status}`)}
                      </span>
                      <span className="text-11-regular text-ink-muted">
                        {props.language.t(`agentTools.capabilities.source.${item.source}`)}
                      </span>
                    </div>
                    {item.detail ? (
                      <p className="col-span-2 max-h-12 overflow-auto whitespace-pre-wrap text-11-regular text-ink-muted">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="py-2 text-12-regular text-ink-muted">{props.language.t("agentTools.capabilities.empty")}</p>
        )}
      </div>
    </section>
  )
}

function AgentToolCard(props: {
  language: SettingsLanguage
  item: AgentTools.Status
  busy: boolean
  working: boolean
  operation: Operation
  operationError: string
  configure: (settings: AgentTools.Settings) => Promise<void>
  install: () => Promise<void>
  probe: () => Promise<void>
  initialize: (directory: string) => Promise<void>
  extension: (action: AgentTools.BrowserExtensionAction) => Promise<void>
}) {
  const language = props.language
  const [state, updateState] = useState({
    command: props.item.settings.command ? JSON.stringify(props.item.settings.command) : "",
    timeout: String(props.item.settings.timeout ?? 120_000),
    copyAll: props.item.settings.copyAll ?? false,
    directory: "",
    error: "",
    copied: false,
  })
  const appearance = card({ padding: "md" })
  const save = async () => {
    updateState((previous) => ({ ...previous, error: "" }))
    try {
      const command = state.command.trim()
        ? Schema.decodeUnknownSync(Schema.fromJsonString(AgentTools.Command))(state.command)
        : undefined
      const settings = Schema.decodeUnknownSync(AgentTools.Settings)({
        enabled: props.item.settings.enabled,
        ...(command ? { command } : {}),
        timeout: Number(state.timeout),
        ...(props.item.id === "rift" ? { copyAll: state.copyAll } : {}),
      })
      await props.configure(settings)
    } catch {
      updateState((previous) => ({ ...previous, error: language.t("agentTools.invalid") }))
    }
  }
  return (
    <section className={appearance.root()} aria-label={language.t(`agentTools.${props.item.id}.name`)}>
      <div className={appearance.header()}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className={appearance.title()}>{language.t(`agentTools.${props.item.id}.name`)}</h3>
          <Switch
            checked={props.item.settings.enabled}
            disabled={props.busy || (!props.item.settings.enabled && (!props.item.supported || !props.item.installed))}
            onCheckedChange={(enabled) => void props.configure({ ...props.item.settings, enabled })}
            label={language.t("agentTools.enabled")}
          />
        </div>
        <p className={appearance.description()}>{language.t(`agentTools.${props.item.id}.description`)}</p>
      </div>
      <div className={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
        <p role="status" className="text-13-regular">
          {language.t(
            !props.item.supported
              ? "agentTools.unsupported"
              : props.working
                ? `agentTools.operation.${props.operation}`
                : props.item.installed
                  ? props.item.settings.enabled
                    ? "agentTools.state.enabled"
                    : "agentTools.state.installed"
                  : "agentTools.state.missing",
          )}
        </p>
        {props.item.supported && !props.item.browserExtension ? (
          <>
            <div className="flex flex-col gap-1 text-13-regular">
              <h4 className="font-medium">{language.t("agentTools.setup.required")}</h4>
              <p>{language.t(`agentTools.${props.item.id}.requirements`)}</p>
              {props.item.id === "browser-control" ? (
                <p>{language.t("agentTools.browser-control.connect")}</p>
              ) : null}
              {props.item.id === "browser-control" || props.item.id === "computer-use" ? (
                <>
                  <p className="text-ink-muted">{language.t("agentTools.setup.manual")}</p>
                </>
              ) : null}
            </div>
          </>
        ) : null}
        {props.item.browserExtension ? (
          <div className="flex flex-col gap-2 text-13-regular">
            <h4 className="font-medium">{language.t("agentTools.chrome.title")}</h4>
            <p>{language.t("agentTools.chrome.scope")}</p>
            <p>{language.t(`agentTools.chrome.state.${props.item.browserExtension.state}`)}</p>
            {props.item.browserExtension.error && props.item.browserExtension.error !== props.operationError ? <pre role="alert" className="whitespace-pre-wrap text-12-regular">{props.item.browserExtension.error}</pre> : null}
            {props.item.browserExtension.chrome ? (
              <code className="break-all text-12-regular">{props.item.browserExtension.chrome}</code>
            ) : null}
            {props.item.browserExtension.state === "registered" ? (
              <p>{language.t("agentTools.chrome.verify")}</p>
            ) : props.item.browserExtension.state !== "chrome-missing" ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={props.busy}
                onClick={() => void props.extension(props.item.browserExtension!.canAuthorize ? "install" : "prepare")}
              >
                {language.t(props.item.browserExtension.canAuthorize ? "agentTools.chrome.install" : "agentTools.chrome.prepare")}
              </Button>
            ) : null}
            {props.item.browserExtension.command && props.item.browserExtension.state !== "registered" ? (
              <div className="flex flex-col gap-1">
                <label className="flex flex-col gap-1">
                  {language.t("agentTools.chrome.command")}
                  <Input readOnly value={props.item.browserExtension.command} />
                </label>
                <Button variant="secondary" size="sm" onClick={() => {
                  void navigator.clipboard.writeText(props.item.browserExtension!.command!).then(
                    () => updateState((previous) => ({ ...previous, copied: true })),
                    (error) => updateState((previous) => ({ ...previous, error: formatServerError(error) })),
                  )
                }}>{language.t(state.copied ? "common.copied" : "agentTools.chrome.copyCommand")}</Button>
                <span className="text-12-regular text-ink-muted">{language.t("agentTools.chrome.commandHelp")}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {((directory) => directory ? (
          <details open={props.item.browserExtension ? undefined : true}>
            <summary>{language.t("agentTools.chrome.manual")}</summary>
            {props.item.browserExtension ? <p className="mt-2 text-13-regular">{language.t("agentTools.browser-control.requirements")}</p> : null}
            <label className="mt-2 flex flex-col gap-1">
              {language.t("agentTools.extension")}
              <Input readOnly value={directory} aria-label={language.t("agentTools.extension")} />
              <span className="text-12-regular text-ink-muted">{language.t("agentTools.extensionHelp")}</span>
            </label>
          </details>
        ) : null)(props.item.extensionDirectory)}
        {((diagnosis) =>
          diagnosis ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-12-regular">{diagnosis}</pre>
          ) : null)(props.item.diagnosis)}
        <details>
          <summary>{language.t("agentTools.options")}</summary>
          <p className="text-12-regular text-ink-muted mt-3">
            {language.t("agentTools.package", { package: props.item.package })}
          </p>
          <form
            className="flex flex-col gap-3 mt-3"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <label>
              {language.t("agentTools.command")}
              <Input
                value={state.command}
                disabled={props.busy}
                placeholder='["/path/to/tool", "mcp"]'
                onValueChange={(command) => updateState((previous) => ({ ...previous, command }))}
              />
            </label>
            <p className="text-12-regular text-ink-muted">{language.t("agentTools.commandHelp")}</p>
            <label>
              {language.t("agentTools.timeout")}
              <Input
                type="number"
                min="1"
                max="600000"
                required
                value={state.timeout}
                disabled={props.busy}
                onValueChange={(timeout) =>
                  updateState((previous) => ({ ...previous, timeout: timeout === null ? "" : String(timeout) }))
                }
              />
            </label>
            {props.item.id === "rift" ? (
              <>
                <Checkbox
                  label={language.t("agentTools.copyAll")}
                  checked={state.copyAll}
                  disabled={props.busy}
                  onCheckedChange={(copyAll) => updateState((previous) => ({ ...previous, copyAll }))}
                />
              </>
            ) : null}
            <Button variant="secondary" size="sm" disabled={props.busy} type="submit">
              {language.t("common.save")}
            </Button>
          </form>
        </details>
        {props.item.id === "rift" && props.item.installed && props.item.supported ? (
          <>
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void props.initialize(state.directory.trim())
              }}
            >
              <label>
                {language.t("agentTools.directory")}
                <Input
                  required
                  value={state.directory}
                  disabled={props.busy}
                  onValueChange={(directory) => updateState((previous) => ({ ...previous, directory }))}
                />
              </label>
              <p className="text-12-regular text-ink-muted">{language.t("agentTools.initializeHelp")}</p>
              <Button type="submit" variant="secondary" size="sm" disabled={props.busy}>
                {language.t("agentTools.initialize")}
              </Button>
            </form>
          </>
        ) : null}
        {state.error ? (
          <>
            <p role="alert">{state.error}</p>
          </>
        ) : null}
      </div>
      <div className={`${appearance.footer()} flex flex-wrap gap-2`}>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.busy || !props.item.supported}
          onClick={() => void props.install()}
        >
          {language.t(props.item.installed ? "agentTools.reinstall" : "agentTools.install")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.busy || !props.item.installed}
          onClick={() => void props.probe()}
        >
          {language.t("agentTools.probe")}
        </Button>
      </div>
    </section>
  )
}

/** @jsxImportSource react */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { AgentTools } from "@opencode/schema/agent-tools"
import { Schema } from "effect"
import { card } from "@reddb-io/design-system/contracts/card"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Checkbox } from "@reddb-io/design-system/base/Checkbox"
import { Switch } from "@reddb-io/design-system/base/Switch"
import type { createAgentToolsServices } from "./agent-tools"
import type { SettingsLanguage } from "../shared.react"

type Operation = "install" | "configure" | "probe" | "initialize"

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
      setSnapshot((current) =>
        current ? { ...current, tools: current.tools.map((tool) => (tool.id === item.id ? item : tool)) } : current,
      )
    } catch {
      if (!controller.signal.aborted)
        updateState((previous) => ({ ...previous, error: language.t("agentTools.failed") }))
    } finally {
      if (!controller.signal.aborted) updateState((previous) => ({ ...previous, busy: "" }))
    }
  }
  return (
    <>
      <div className="settings-tab-header">
        <h2 className="settings-tab-title">{language.t("agentTools.title")}</h2>
        <p className="text-13-regular text-ink-muted">{language.t("agentTools.description")}</p>
      </div>
      <div className="settings-tab-body settings-tab-body--sectioned">
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
                />
              ))}
            </>
          ) : null)(snapshot)}
      </div>
    </>
  )
}

function AgentToolCard(props: {
  language: SettingsLanguage
  item: AgentTools.Status
  busy: boolean
  working: boolean
  operation: Operation
  configure: (settings: AgentTools.Settings) => Promise<void>
  install: () => Promise<void>
  probe: () => Promise<void>
  initialize: (directory: string) => Promise<void>
}) {
  const language = props.language
  const [state, updateState] = useState({
    command: props.item.settings.command ? JSON.stringify(props.item.settings.command) : "",
    timeout: String(props.item.settings.timeout ?? 120_000),
    copyAll: props.item.settings.copyAll ?? false,
    directory: "",
    error: "",
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
        {props.item.supported ? (
          <>
            <div className="flex flex-col gap-1 text-13-regular">
              <h4 className="font-medium">{language.t("agentTools.setup.required")}</h4>
              <p>{language.t(`agentTools.${props.item.id}.requirements`)}</p>
              {props.item.id === "browser-control" || props.item.id === "computer-use" ? (
                <>
                  <p className="text-ink-muted">{language.t("agentTools.setup.manual")}</p>
                </>
              ) : null}
            </div>
          </>
        ) : null}
        {((directory) =>
          directory ? (
            <label className="flex flex-col gap-1">
              {language.t("agentTools.extension")}
              <Input readOnly value={directory} aria-label={language.t("agentTools.extension")} />
              <span className="text-12-regular text-ink-muted">{language.t("agentTools.extensionHelp")}</span>
            </label>
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

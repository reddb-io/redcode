import { AgentTools } from "@opencode/schema/agent-tools"
import { Schema } from "effect"
import { button } from "@reddb-io/design-system/contracts/button"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { Switch } from "@opencode/ui/switch"
import { createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"

type Operation = "install" | "configure" | "probe" | "initialize"

export function SettingsAgentTools() {
  const sdk = useServerSDK()
  const language = useLanguage()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({ busy: "", operation: "install" as Operation, error: "", success: "" })
  const appearance = card({ padding: "md" })
  const [snapshot, actions] = createResource(
    () => (sdk.connection.status() === "connected" ? sdk.api : undefined),
    async (api) =>
      Schema.decodeUnknownSync(AgentTools.Snapshot)(await api.agentTools.list({ signal: controller.signal })),
  )
  const run = async (id: AgentTools.ID, operation: Operation, action: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: id, operation, error: "", success: "" })
    try {
      const result = await action()
      if (controller.signal.aborted) return
      if (operation === "initialize") {
        setState("success", language.t("agentTools.initialized"))
        return
      }
      const item = Schema.decodeUnknownSync(AgentTools.Status)(result)
      actions.mutate((current) =>
        current ? { ...current, tools: current.tools.map((tool) => (tool.id === item.id ? item : tool)) } : current,
      )
    } catch {
      if (!controller.signal.aborted) setState("error", language.t("agentTools.failed"))
    } finally {
      if (!controller.signal.aborted) setState("busy", "")
    }
  }
  return (
    <>
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("agentTools.title")}</h2>
        <p class="text-13-regular text-ink-muted">{language.t("agentTools.description")}</p>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={snapshot.error}>
          <p role="alert">{language.t("agentTools.unavailable")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert">{state.error}</p>
        </Show>
        <Show when={state.success}>
          <p role="status">{state.success}</p>
        </Show>
        <Show when={snapshot.latest}>
          {(value) => (
            <>
              <section class={appearance.root()} aria-label={language.t("agentTools.setup.title")}>
                <div class={appearance.header()}>
                  <h3 class={appearance.title()}>{language.t("agentTools.setup.title")}</h3>
                  <p class={appearance.description()}>{language.t("agentTools.host", value().host)}</p>
                </div>
                <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
                  <p class="text-13-regular">{language.t("agentTools.setup.target", { name: value().host.name })}</p>
                  <ol class="list-decimal pl-5 flex flex-col gap-2 text-13-regular">
                    <li>{language.t("agentTools.setup.install")}</li>
                    <li>{language.t("agentTools.setup.prepare")}</li>
                    <li>{language.t("agentTools.setup.enable")}</li>
                  </ol>
                </div>
              </section>
              <button
                class={button({ variant: "secondary", size: "sm" })}
                disabled={!!state.busy}
                onClick={() => void actions.refetch()}
              >
                {language.t("agentTools.refresh")}
              </button>
              <For each={value().tools}>
                {(item) => (
                  <AgentToolCard
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
                )}
              </For>
            </>
          )}
        </Show>
      </div>
    </>
  )
}

function AgentToolCard(props: {
  item: AgentTools.Status
  busy: boolean
  working: boolean
  operation: Operation
  configure: (settings: AgentTools.Settings) => Promise<void>
  install: () => Promise<void>
  probe: () => Promise<void>
  initialize: (directory: string) => Promise<void>
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    command: props.item.settings.command ? JSON.stringify(props.item.settings.command) : "",
    timeout: String(props.item.settings.timeout ?? 120_000),
    copyAll: props.item.settings.copyAll ?? false,
    directory: "",
    error: "",
  })
  const appearance = card({ padding: "md" })
  const save = async () => {
    setState("error", "")
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
      setState("error", language.t("agentTools.invalid"))
    }
  }
  return (
    <section class={appearance.root()} aria-label={language.t(`agentTools.${props.item.id}.name`)}>
      <div class={appearance.header()}>
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h3 class={appearance.title()}>{language.t(`agentTools.${props.item.id}.name`)}</h3>
          <Switch
            checked={props.item.settings.enabled}
            disabled={props.busy || (!props.item.settings.enabled && (!props.item.supported || !props.item.installed))}
            onChange={(enabled) => void props.configure({ ...props.item.settings, enabled })}
          >
            {language.t("agentTools.enabled")}
          </Switch>
        </div>
        <p class={appearance.description()}>{language.t(`agentTools.${props.item.id}.description`)}</p>
      </div>
      <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
        <p role="status" class="text-13-regular">
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
        <Show when={props.item.supported}>
          <div class="flex flex-col gap-1 text-13-regular">
            <h4 class="font-medium">{language.t("agentTools.setup.required")}</h4>
            <p>{language.t(`agentTools.${props.item.id}.requirements`)}</p>
            <Show when={props.item.id === "browser-control" || props.item.id === "computer-use"}>
              <p class="text-ink-muted">{language.t("agentTools.setup.manual")}</p>
            </Show>
          </div>
        </Show>
        <Show when={props.item.extensionDirectory}>
          {(directory) => (
            <label class="flex flex-col gap-1">
              {language.t("agentTools.extension")}
              <input class={input()} readOnly value={directory()} aria-label={language.t("agentTools.extension")} />
              <span class="text-12-regular text-ink-muted">{language.t("agentTools.extensionHelp")}</span>
            </label>
          )}
        </Show>
        <Show when={props.item.diagnosis}>
          {(diagnosis) => <pre class="max-h-48 overflow-auto whitespace-pre-wrap text-12-regular">{diagnosis()}</pre>}
        </Show>
        <details>
          <summary>{language.t("agentTools.options")}</summary>
          <p class="text-12-regular text-ink-muted mt-3">
            {language.t("agentTools.package", { package: props.item.package })}
          </p>
          <form
            class="flex flex-col gap-3 mt-3"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <label>
              {language.t("agentTools.command")}
              <input
                class={input()}
                value={state.command}
                disabled={props.busy}
                placeholder='["/path/to/tool", "mcp"]'
                onInput={(event) => setState("command", event.currentTarget.value)}
              />
            </label>
            <p class="text-12-regular text-ink-muted">{language.t("agentTools.commandHelp")}</p>
            <label>
              {language.t("agentTools.timeout")}
              <input
                class={input()}
                type="number"
                min="1"
                max="600000"
                required
                value={state.timeout}
                disabled={props.busy}
                onInput={(event) => setState("timeout", event.currentTarget.value)}
              />
            </label>
            <Show when={props.item.id === "rift"}>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={state.copyAll}
                  disabled={props.busy}
                  onChange={(event) => setState("copyAll", event.currentTarget.checked)}
                />
                {language.t("agentTools.copyAll")}
              </label>
            </Show>
            <button class={button({ variant: "secondary", size: "sm" })} disabled={props.busy} type="submit">
              {language.t("common.save")}
            </button>
          </form>
        </details>
        <Show when={props.item.id === "rift" && props.item.installed && props.item.supported}>
          <form
            class="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void props.initialize(state.directory.trim())
            }}
          >
            <label>
              {language.t("agentTools.directory")}
              <input
                class={input()}
                required
                value={state.directory}
                disabled={props.busy}
                onInput={(event) => setState("directory", event.currentTarget.value)}
              />
            </label>
            <p class="text-12-regular text-ink-muted">{language.t("agentTools.initializeHelp")}</p>
            <button type="submit" class={button({ variant: "secondary", size: "sm" })} disabled={props.busy}>
              {language.t("agentTools.initialize")}
            </button>
          </form>
        </Show>
        <Show when={state.error}>
          <p role="alert">{state.error}</p>
        </Show>
      </div>
      <div class={`${appearance.footer()} flex flex-wrap gap-2`}>
        <button
          class={button({ variant: "secondary", size: "sm" })}
          disabled={props.busy || !props.item.supported}
          onClick={() => void props.install()}
        >
          {language.t(props.item.installed ? "agentTools.reinstall" : "agentTools.install")}
        </button>
        <button
          class={button({ variant: "secondary", size: "sm" })}
          disabled={props.busy || !props.item.installed}
          onClick={() => void props.probe()}
        >
          {language.t("agentTools.probe")}
        </button>
      </div>
    </section>
  )
}

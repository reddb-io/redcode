import { Harness } from "@opencode/schema/harness"
import { useSearchParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { textarea } from "@reddb-io/design-system/contracts/textarea"
import { Button } from "@opencode/ui/button"
import { Tabs } from "@opencode/ui/tabs"
import { badge } from "@reddb-io/design-system/contracts/badge"
import { multiColumnLayout } from "@reddb-io/design-system/contracts/multi-column-layout"
import { SearchSelect } from "@/runtime/react/search-select"
import { sidebarPanel } from "@reddb-io/design-system/contracts/sidebar-panel"
import { batch, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import { useLanguage } from "@/runtime/i18n/language"
import { uuid } from "@/runtime/persistence/uuid"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"
import { useNavigation } from "./controller"

export default function AgentHarnesses(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const navigation = useNavigation()
  const [params, setParams] = useSearchParams()
  const api = () => global.ensureServerCtx(props.server).sdk.api.harness
  const connected = () => global.ensureServerCtx(props.server).sdk.connection.status() === "connected"
  const [state, setState] = createStore({
    view: "sessions",
    driver: "redcode" as Harness.Driver | "redcode",
    providerInstanceID: "",
    directory: "",
    model: "",
    customModel: false,
    backgroundWait: false,
    delegation: false,
    executable: {} as Record<string, string>,
    home: {} as Record<string, string>,
    idleTimeoutSeconds: {} as Record<string, string>,
    newInstance: {
      driver: "codex" as Harness.Driver,
      id: "",
      label: "",
      executable: "codex",
      home: "",
      idleTimeoutSeconds: "60",
    },
    busy: false,
    error: "",
    runID: "",
    inspecting: false,
    prompt: "",
    promptID: uuid(),
    delivery: "queue" as "queue" | "steer",
    answers: {} as Record<string, string>,
    code: "",
    stopped: false,
    login: undefined as string | undefined,
  })
  const lifetime = { active: true }
  onCleanup(() => {
    lifetime.active = false
  })
  const appearance = card({ padding: "md" })
  const inspector = sidebarPanel()
  const columns = multiColumnLayout()
  const query = useQuery(() => ({
    queryKey: ["harnesses", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => api().list({ signal }),
    enabled: connected(),
    retry: false,
    refetchInterval: 3000,
  }))
  const detail = useQuery(() => ({
    queryKey: ["harness-run", ServerConnection.key(props.server), state.runID],
    queryFn: ({ signal }) => api().read({ runID: state.runID }, { signal }),
    enabled: connected() && !!state.runID && state.inspecting,
    retry: false,
    refetchInterval: 1000,
  }))
  const login = useQuery(() => ({
    queryKey: ["harness-login", ServerConnection.key(props.server), state.login],
    queryFn: ({ signal }) => api().loginStatus({ providerInstanceID: state.login! }, { signal }),
    enabled: connected() && !!state.login,
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === "pending" ? 1000 : false),
  }))
  const action = async (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    try {
      await run()
      if (lifetime.active) {
        void query.refetch()
        if (state.runID && state.inspecting) void detail.refetch()
      }
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) setState("busy", false)
    }
  }
  let inspectorElement: HTMLElement | undefined
  let requestsElement: HTMLElement | undefined
  let openElement: HTMLButtonElement | undefined
  const focusInspector = () => {
    if (!inspectorElement?.isConnected) return
    inspectorElement.focus({ preventScroll: true })
    inspectorElement.scrollIntoView({ block: "nearest" })
  }
  const inspect = (runID: string) => {
    if (runID === state.runID && state.inspecting) return focusInspector()
    const visible = state.inspecting
    batch(() => {
      if (runID !== state.runID) setState("answers", reconcile({}))
      setState({
        ...(runID !== state.runID
          ? {
              stopped: false,
              prompt: "",
              delivery: "queue" as const,
              promptID: uuid(),
            }
          : {}),
        runID,
        inspecting: !!runID,
      })
    })
    if (visible) queueMicrotask(focusInspector)
  }
  const back = () => {
    setState("inspecting", false)
    queueMicrotask(() => {
      if (!openElement?.isConnected) return
      openElement.focus({ preventScroll: true })
      openElement.scrollIntoView({ block: "nearest" })
    })
  }
  const directory = () => state.directory || (typeof params.directory === "string" ? params.directory : "")
  const providerID = (provider: { id?: string; driver: Harness.Driver }) => provider.id ?? provider.driver
  const selectedProviderID = () => {
    if (state.driver === "redcode") return "redcode"
    const provider = query.data?.providers.find((item) => item.driver === state.driver)
    return state.providerInstanceID || (provider ? providerID(provider) : state.driver)
  }
  return (
    <div class="flex flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <Show when={query.isError || !connected()}>
        <p role="alert">{language.t("harness.externalUnavailable")}</p>
      </Show>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <div class={columns.root()}>
        <Show when={state.inspecting}>
          <article
            ref={(element) => {
              inspectorElement = element
              queueMicrotask(focusInspector)
            }}
            tabIndex={-1}
            aria-label={language.t("harness.inspector")}
            aria-busy={detail.isPending}
            class={columns.main({
              class: columns.column({
                class: inspector.root({
                  class:
                    "order-2 max-h-[min(80dvh,calc(var(--agents-content-height,100dvh)-2rem))] rounded-lg border border-muted focus-visible:outline-2 focus-visible:outline-focus",
                }),
              }),
            })}
          >
            <header class={inspector.toolbar({ class: "flex-wrap" })}>
              <h3 class="min-w-0 flex-1 text-body font-medium">
                <Show when={detail.data} fallback={language.t("harness.inspector")}>
                  {(result) => (
                    <>
                      {language.t(`harness.driver.${result().run.driver}`)} ·{" "}
                      {language.t(`harness.state.${result().run.state}`)}
                    </>
                  )}
                </Show>
              </h3>
              <Button
                variant="ghost"
                aria-label={language.t(navigation.mobile() ? "harness.backToSessions" : "common.close")}
                onClick={back}
              >
                {language.t(navigation.mobile() ? "harness.back" : "common.close")}
              </Button>
              <Show when={detail.data?.requests.length}>
                <Button
                  variant="outline"
                  aria-label={language.t("harness.reviewRequests")}
                  onClick={() => {
                    const body = requestsElement?.parentElement
                    if (!requestsElement || !body) return
                    requestsElement.focus({ preventScroll: true })
                    body.scrollTop += requestsElement.getBoundingClientRect().top - body.getBoundingClientRect().top
                  }}
                >
                  {language.t(navigation.mobile() ? "harness.requestsShort" : "harness.reviewRequests")}
                </Button>
              </Show>
            </header>
            <Show when={detail.isError}>
              <p role="alert" class="p-[var(--reddb-spatial-inset-sm)]">
                {language.t("harness.runUnavailable")}
              </p>
            </Show>
            <Show when={detail.isPending}>
              <p role="status" class="p-[var(--reddb-spatial-inset-sm)]">
                {language.t("agents.loading")}
              </p>
            </Show>
            <Show when={detail.data}>
              {(result) => (
                <div
                  class={inspector.body({
                    class:
                      "flex flex-col gap-[var(--reddb-spatial-gap-md)] overflow-y-auto pt-[var(--reddb-spatial-inset-sm)]",
                  })}
                >
                  <Show when={result().run.state === "unknown"}>
                    <section class="flex flex-col gap-2">
                      <p>{language.t("harness.reconcileNote")}</p>
                      <label class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={state.stopped}
                          onChange={(event) => setState("stopped", event.currentTarget.checked)}
                        />
                        {language.t("harness.originalStopped")}
                      </label>
                      <Button
                        variant="outline"
                        disabled={state.busy || !state.stopped}
                        onClick={() =>
                          void action(async () => {
                            await api().reconcile({ runID: state.runID })
                            if (lifetime.active) setState("stopped", false)
                          })
                        }
                      >
                        {language.t("harness.reconcile")}
                      </Button>
                    </section>
                  </Show>
                  <Show when={result().run.backgroundWait}>
                    <p class="text-ink-muted">{language.t("harness.backgroundWaitEnabled")}</p>
                  </Show>
                  <Show when={result().requests.length}>
                    <section
                      ref={requestsElement}
                      tabIndex={-1}
                      aria-label={language.t("harness.requests")}
                      class="flex flex-col gap-[var(--reddb-spatial-gap-md)] focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <Key each={result().requests} by="id">
                        {(request) => (
                          <section class="rounded border border-v2-border-base p-3">
                            <h4 class="text-13-medium">{language.t(`harness.request.${request().kind}`)}</h4>
                            <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-words">{request().detail}</pre>
                            <Key each={request().questions} by="id">
                              {(question) => (
                                <label class="mt-2 block">
                                  {question().text}
                                  <input
                                    class={input({ size: "sm", class: "mt-1 w-full" })}
                                    list={`${state.runID}-${request().id}-${question().id}`}
                                    value={state.answers[`${request().id}:${question().id}`] ?? ""}
                                    onInput={(event) =>
                                      setState("answers", `${request().id}:${question().id}`, event.currentTarget.value)
                                    }
                                  />
                                  <datalist id={`${state.runID}-${request().id}-${question().id}`}>
                                    <For each={question().options}>{(option) => <option value={option} />}</For>
                                  </datalist>
                                </label>
                              )}
                            </Key>
                            <div class="mt-3 flex gap-2">
                              <Show when={request().kind !== "unsupported"}>
                                <Button
                                  disabled={state.busy}
                                  onClick={() =>
                                    void action(() =>
                                      api().answer({
                                        runID: state.runID,
                                        request: request().id,
                                        allow: true,
                                        answers: Object.fromEntries(
                                          request().questions.map((question) => [
                                            question.id,
                                            state.answers[`${request().id}:${question.id}`] ?? "",
                                          ]),
                                        ),
                                      }),
                                    )
                                  }
                                >
                                  {language.t(request().kind === "question" ? "harness.answer" : "harness.allow")}
                                </Button>
                              </Show>
                              <Button
                                variant="outline"
                                disabled={state.busy}
                                onClick={() =>
                                  void action(() =>
                                    api().answer({
                                      runID: state.runID,
                                      request: request().id,
                                      allow: false,
                                      answers: {},
                                    }),
                                  )
                                }
                              >
                                {language.t("harness.decline")}
                              </Button>
                            </div>
                          </section>
                        )}
                      </Key>
                    </section>
                  </Show>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void action(async () => {
                        await api().prompt({
                          runID: state.runID,
                          id: state.promptID,
                          text: state.prompt,
                          delivery: state.delivery,
                        })
                        if (lifetime.active) setState({ prompt: "", promptID: uuid() })
                      })
                    }}
                    class="flex flex-col gap-2"
                  >
                    <label>
                      {language.t("harness.instruction")}
                      <textarea
                        required
                        class={textarea({ class: "mt-1 w-full" })}
                        value={state.prompt}
                        onInput={(event) => setState({ prompt: event.currentTarget.value, promptID: uuid() })}
                      />
                    </label>
                    <label>
                      {language.t("harness.delivery")}
                      <select
                        aria-label={language.t("harness.delivery")}
                        class={input({ size: "sm" })}
                        value={state.delivery}
                        onChange={(event) =>
                          setState({
                            delivery: event.currentTarget.value === "steer" ? "steer" : "queue",
                            promptID: uuid(),
                          })
                        }
                      >
                        <option value="queue">{language.t("harness.queue")}</option>
                        <Show when={result().run.capabilities.steer}>
                          <option value="steer">{language.t("harness.steer")}</option>
                        </Show>
                      </select>
                    </label>
                    <Button
                      type="submit"
                      disabled={
                        state.busy ||
                        !state.prompt.trim() ||
                        !["ready", "running", "waiting", "interrupted"].includes(result().run.state)
                      }
                    >
                      {language.t("harness.send")}
                    </Button>
                  </form>
                  <details open={!navigation.mobile()}>
                    <summary class="cursor-pointer py-[var(--reddb-spatial-gap-sm)] text-body">
                      {language.t("harness.executionControls")}
                    </summary>
                    <p class="break-all text-ink-muted">{result().run.directory}</p>
                    <Show when={result().run.detail}>
                      <p role="status">{result().run.detail}</p>
                    </Show>
                    <p>{language.plural("harness.queued", result().run.queued, { count: result().run.queued })}</p>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={state.busy || !["running", "waiting"].includes(result().run.state)}
                        onClick={() => void action(() => api().interrupt({ runID: state.runID }))}
                      >
                        {language.t("harness.interrupt")}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          state.busy ||
                          !["interrupted", "failed"].includes(result().run.state) ||
                          !result().run.nativeID
                        }
                        onClick={() => void action(() => api().resume({ runID: state.runID }))}
                      >
                        {language.t("harness.resume")}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={state.busy || ["closed", "unknown"].includes(result().run.state)}
                        onClick={() => void action(() => api().close({ runID: state.runID }))}
                      >
                        {language.t("harness.close")}
                      </Button>
                    </div>
                  </details>
                  <details open={!navigation.mobile()}>
                    <summary class="cursor-pointer py-[var(--reddb-spatial-gap-sm)] text-body">
                      {language.t("harness.output")}
                    </summary>
                    <div
                      role="log"
                      tabIndex={0}
                      aria-label={language.t("harness.output")}
                      class="max-h-96 overflow-auto rounded border border-v2-border-base p-3"
                    >
                      <Key each={result().events} by="cursor">
                        {(event) => (
                          <span
                            class={event().kind === "text" ? "whitespace-pre-wrap break-words" : "block text-ink-muted"}
                          >
                            {event().text}
                          </span>
                        )}
                      </Key>
                    </div>
                  </details>
                </div>
              )}
            </Show>
          </article>
        </Show>

        <div
          hidden={state.inspecting && navigation.mobile()}
          class={columns.start({ class: columns.column({ class: "@container/harness-workspace order-1" }) })}
        >
          <Tabs
            variant="line"
            value={state.view}
            onChange={(value) => setState("view", value)}
            class="!h-auto !overflow-visible"
          >
            <Tabs.List aria-label={language.t("harness.tabs.label")}>
              <Tabs.Trigger value="sessions">{language.t("executors.sessions")}</Tabs.Trigger>
              <Tabs.Trigger value="setup">{language.t("harness.tabs.setup")}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content
              value="sessions"
              forceMount
              hidden={state.view !== "sessions"}
              class="!overflow-visible space-y-4 pt-4"
            >
              <p class="text-body text-ink-muted">{language.t("executors.description")}</p>
              <article class={appearance.root()}>
                <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
                  <h3 class="text-13-medium">{language.t("executors.externalSessions")}</h3>
                  <Show
                    when={query.data?.runs.length}
                    fallback={
                      <Show when={query.isPending || (!!query.data && !query.isError)}>
                        <p class="text-body text-ink-muted">
                          {language.t(query.isPending ? "agents.loading" : "executors.empty")}
                        </p>
                      </Show>
                    }
                  >
                    <SearchSelect
                      label={language.t("executors.externalSessions")}
                      value={state.runID}
                      options={(query.data?.runs ?? []).map((run) => ({
                        value: run.id,
                        label: `${language.t(`harness.driver.${run.driver}`)} · ${run.directory}`,
                        description: language.t(`harness.state.${run.state}`),
                        keywords: [run.id, run.nativeID ?? ""],
                      }))}
                      onChange={inspect}
                    />
                  </Show>
                  <Show when={state.runID}>
                    <Button ref={openElement} variant="outline" onClick={() => inspect(state.runID)}>
                      {language.t("harness.showDetails")}
                    </Button>
                  </Show>
                </div>
              </article>

              <form
                class={appearance.root()}
                onSubmit={(event) => {
                  event.preventDefault()
                  void action(async () => {
                    if (state.driver === "redcode") {
                      const session = await global.ensureServerCtx(props.server).sdk.api.session.create({
                        location: { directory: directory() },
                      })
                      if (lifetime.active) navigation.session.open(session, { server: props.server })
                      return
                    }
                    const run = await api().open({
                      driver: state.driver,
                      providerInstanceID: selectedProviderID(),
                      directory: directory(),
                      ...(state.model.trim() ? { model: state.model.trim() } : {}),
                      ...(state.backgroundWait ? { backgroundWait: true } : {}),
                      ...(state.delegation ? { delegation: true } : {}),
                    })
                    if (lifetime.active) inspect(run.id)
                  })
                }}
              >
                <div class={appearance.body({ class: "grid gap-3 @md/harness-workspace:grid-cols-2 space-y-0" })}>
                  <h3 class="text-13-medium @md/harness-workspace:col-span-2">
                    {language.t(state.driver === "redcode" ? "harness.native.start" : "harness.start")}
                  </h3>
                  <label>
                    {language.t("harness.provider")}
                    <SearchSelect
                      label={language.t("harness.provider")}
                      class="mt-1 w-full"
                      value={state.driver === "redcode" ? "redcode" : selectedProviderID()}
                      options={[
                        { value: "redcode", label: language.t("harness.driver.redcode") },
                        ...(query.data?.providers ?? []).map((provider) => ({
                          value: providerID(provider),
                          label: `${language.t(`harness.driver.${provider.driver}`)} · ${provider.label ?? "Default"}`,
                          description: provider.home || provider.executable,
                        })),
                      ]}
                      onChange={(value) => {
                        if (value === "redcode") {
                          setState({ driver: value, providerInstanceID: "", model: "", customModel: false })
                          return
                        }
                        const provider = query.data?.providers.find((item) => providerID(item) === value)
                        if (provider)
                          setState({
                            driver: provider.driver,
                            providerInstanceID: providerID(provider),
                            model: "",
                            customModel: false,
                          })
                      }}
                    />
                  </label>
                  <Show when={state.driver !== "redcode"}>
                    <div>
                      <span>{language.t("harness.model")}</span>
                      <SearchSelect
                        label={language.t("harness.model")}
                        class="mt-1 w-full"
                        value={state.customModel ? "__custom_model__" : state.model}
                        options={[
                          { value: "", label: language.t("harness.model.default") },
                          ...(
                            query.data?.providers.find(
                              (provider) =>
                                providerID(provider) === selectedProviderID(),
                            )?.models ?? []
                          ).map((model) => ({
                            value: model.id,
                            label: model.label,
                            description: model.recommended ? language.t("harness.model.recommended") : model.id,
                          })),
                          { value: "__custom_model__", label: language.t("harness.model.custom") },
                        ]}
                        onChange={(value) =>
                          setState({
                            customModel: value === "__custom_model__",
                            model: value === "__custom_model__" ? "" : value,
                          })
                        }
                      />
                      <Show when={state.customModel}>
                        <label class="mt-2 block">
                          {language.t("harness.model.customID")}
                          <input
                            class={input({ size: "sm", class: "mt-1 w-full" })}
                            value={state.model}
                            onInput={(event) => setState("model", event.currentTarget.value)}
                          />
                        </label>
                      </Show>
                    </div>
                  </Show>
                  <Show when={state.driver === "redcode"}>
                    <p class="text-ink-muted">{language.t("harness.native.description")}</p>
                  </Show>
                  <Show when={state.driver !== "redcode"}>
                    <div class="@md/harness-workspace:col-span-2">
                      <label class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={state.backgroundWait}
                          disabled={state.busy}
                          onChange={(event) => setState("backgroundWait", event.currentTarget.checked)}
                        />
                        {language.t("harness.backgroundWait")}
                      </label>
                      <p class="mt-1 text-ink-muted">{language.t("harness.backgroundWaitNote")}</p>
                      <label class="mt-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={state.delegation}
                          disabled={state.busy}
                          onChange={(event) => setState("delegation", event.currentTarget.checked)}
                        />
                        {language.t("harness.delegation")}
                      </label>
                      <p class="mt-1 text-ink-muted">{language.t("harness.delegationNote")}</p>
                    </div>
                  </Show>
                  <label class="@md/harness-workspace:col-span-2">
                    {language.t("harness.directory")}
                    <input
                      required
                      class={input({ size: "sm", class: "mt-1 w-full" })}
                      value={directory()}
                      onInput={(event) => {
                        setState("directory", event.currentTarget.value)
                        setParams({ directory: undefined })
                      }}
                    />
                  </label>
                  <Button type="submit" disabled={state.busy || !connected() || !directory().trim()}>
                    {language.t(state.driver === "redcode" ? "harness.native.start" : "harness.start")}
                  </Button>
                </div>
              </form>
            </Tabs.Content>
            <Tabs.Content
              value="setup"
              forceMount
              hidden={state.view !== "setup"}
              class="!overflow-visible space-y-4 pt-4"
            >
              <p class="text-ink-muted">{language.t("harness.description")}</p>
              <details class={appearance.root()}>
                <summary class="cursor-pointer text-13-medium">{language.t("harness.instance.add")}</summary>
                <form
                  class="mt-3 grid gap-3 @md/harness-workspace:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void action(async () => {
                      await api().configure({
                        id: state.newInstance.id.trim(),
                        driver: state.newInstance.driver,
                        label: state.newInstance.label.trim(),
                        executable: state.newInstance.executable.trim(),
                        ...(state.newInstance.home.trim() ? { home: state.newInstance.home.trim() } : {}),
                        idleTimeoutMs: Number(state.newInstance.idleTimeoutSeconds) * 1000,
                      })
                      if (lifetime.active)
                        setState("newInstance", {
                          driver: "codex",
                          id: "",
                          label: "",
                          executable: "codex",
                          home: "",
                          idleTimeoutSeconds: "60",
                        })
                    })
                  }}
                >
                  <label>
                    {language.t("harness.instance.driver")}
                    <select
                      class={input({ size: "sm", class: "mt-1 w-full" })}
                      value={state.newInstance.driver}
                      onChange={(event) => {
                        const driver = event.currentTarget.value === "claude" ? "claude" : "codex"
                        setState("newInstance", { driver, executable: driver })
                      }}
                    >
                      <option value="codex">{language.t("harness.driver.codex")}</option>
                      <option value="claude">{language.t("harness.driver.claude")}</option>
                    </select>
                  </label>
                  <label>
                    {language.t("harness.instance.label")}
                    <input
                      required
                      class={input({ size: "sm", class: "mt-1 w-full" })}
                      value={state.newInstance.label}
                      onInput={(event) => setState("newInstance", "label", event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    {language.t("harness.instance.id")}
                    <input
                      required
                      class={input({ size: "sm", class: "mt-1 w-full" })}
                      value={state.newInstance.id}
                      placeholder="codex-work"
                      onInput={(event) => setState("newInstance", "id", event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    {language.t("harness.executable")}
                    <input
                      required
                      class={input({ size: "sm", class: "mt-1 w-full" })}
                      value={state.newInstance.executable}
                      onInput={(event) => setState("newInstance", "executable", event.currentTarget.value)}
                    />
                  </label>
                  <label class="@md/harness-workspace:col-span-2">
                    {language.t("harness.instanceHome")}
                    <input
                      class={input({ size: "sm", class: "mt-1 w-full" })}
                      value={state.newInstance.home}
                      placeholder={language.t("harness.instanceHomeDefault")}
                      onInput={(event) => setState("newInstance", "home", event.currentTarget.value)}
                    />
                  </label>
                  <Show when={state.newInstance.driver === "codex"}>
                    <label>
                      {language.t("harness.instance.idleTimeout")}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        class={input({ size: "sm", class: "mt-1 w-full" })}
                        value={state.newInstance.idleTimeoutSeconds}
                        onInput={(event) =>
                          setState("newInstance", "idleTimeoutSeconds", event.currentTarget.value)
                        }
                      />
                      <span class="mt-1 block text-caption text-ink-muted">
                        {language.t("harness.instance.idleTimeoutNote")}
                      </span>
                    </label>
                  </Show>
                  <Button
                    type="submit"
                    disabled={
                      state.busy ||
                      !state.newInstance.id.trim() ||
                      !state.newInstance.label.trim() ||
                      !state.newInstance.executable.trim()
                    }
                  >
                    {language.t("harness.instance.create")}
                  </Button>
                </form>
              </details>
              <div class="grid gap-4 @2xl/harness-workspace:grid-cols-2">
                <For each={query.data?.providers}>
                  {(provider) => (
                    <article class={appearance.root()} aria-label={language.t(`harness.driver.${provider.driver}`)}>
                      <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
                        <h3 class="text-13-medium">
                          {language.t(`harness.driver.${provider.driver}`)} · {provider.label ?? "Default"}
                        </h3>
                        <p class="text-caption text-ink-muted">
                          {providerID(provider)}
                          <Show when={provider.credentialRevision !== undefined}>
                            {" · "}
                            {language.t("harness.instance.credentialRevision", {
                              revision: provider.credentialRevision ?? 0,
                            })}
                          </Show>
                        </p>
                        <div class="flex flex-wrap items-center gap-2">
                          <span
                            class={badge({ tone: provider.installed ? "success" : "warning", variant: "tinted" })}
                          >
                            {language.t(provider.installed ? "harness.installed" : "harness.notInstalled")}
                          </span>
                          <span class="text-caption text-ink-muted">
                            {provider.version || language.t("harness.notChecked")}
                          </span>
                        </div>
                        <Show when={provider.authenticated !== undefined}>
                          <p>{language.t(provider.authenticated ? "harness.signedIn" : "harness.signedOut")}</p>
                        </Show>
                        <Show when={provider.detail}>
                          <p role="status" class="text-ink-muted">
                            {provider.detail}
                          </p>
                        </Show>
                        <label>
                          {language.t("harness.executable")}
                          <input
                            class={input({ size: "sm", class: "mt-1 w-full" })}
                            value={state.executable[providerID(provider)] || provider.executable}
                            onInput={(event) => setState("executable", providerID(provider), event.currentTarget.value)}
                          />
                        </label>
                        <Show when={provider.driver === "codex"}>
                          <label>
                            {language.t("harness.instance.idleTimeout")}
                            <input
                              type="number"
                              min="0"
                              step="1"
                              class={input({ size: "sm", class: "mt-1 w-full" })}
                              value={
                                state.idleTimeoutSeconds[providerID(provider)] ??
                                String((provider.idleTimeoutMs ?? 60_000) / 1000)
                              }
                              onInput={(event) =>
                                setState("idleTimeoutSeconds", providerID(provider), event.currentTarget.value)
                              }
                            />
                            <span class="mt-1 block text-caption text-ink-muted">
                              {language.t("harness.instance.idleTimeoutNote")}
                            </span>
                          </label>
                        </Show>
                        <label>
                          {language.t("harness.instanceHome")}
                          <input
                            class={input({ size: "sm", class: "mt-1 w-full" })}
                            value={state.home[providerID(provider)] ?? provider.home ?? ""}
                            placeholder={language.t("harness.instanceHomeDefault")}
                            onInput={(event) => setState("home", providerID(provider), event.currentTarget.value)}
                          />
                        </label>
                        <div class="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={state.busy}
                            onClick={() =>
                              void action(() =>
                                api().configure({
                                  id: provider.id,
                                  driver: provider.driver,
                                  label: provider.label,
                                  executable: state.executable[providerID(provider)] || provider.executable,
                                  ...((state.home[providerID(provider)] ?? provider.home)?.trim()
                                    ? { home: (state.home[providerID(provider)] ?? provider.home)!.trim() }
                                    : {}),
                                  idleTimeoutMs:
                                    Number(
                                      state.idleTimeoutSeconds[providerID(provider)] ??
                                        (provider.idleTimeoutMs ?? 60_000) / 1000,
                                    ) * 1000,
                                }),
                              )
                            }
                          >
                            {language.t("harness.saveAndCheck")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={state.busy}
                            onClick={() =>
                              void action(() => api().probe({ providerInstanceID: providerID(provider) }))
                            }
                          >
                            {language.t("harness.check")}
                          </Button>
                          <Show when={!provider.installed}>
                            <Button
                              variant="outline"
                              disabled={state.busy}
                              onClick={() => void action(() => api().install({ driver: provider.driver }))}
                            >
                              {language.t("harness.install")}
                            </Button>
                          </Show>
                          <Button
                            variant="outline"
                            disabled={state.busy || !provider.installed}
                            onClick={() =>
                              void action(async () => {
                                await api().login({ providerInstanceID: providerID(provider) })
                                if (lifetime.active) {
                                  setState("login", providerID(provider))
                                  void login.refetch()
                                }
                              })
                            }
                          >
                            {language.t("harness.signIn")}
                          </Button>
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
              <details class="text-body text-ink-muted">
                <summary class="cursor-pointer py-2">{language.t("harness.setupDetails")}</summary>
                <p>{language.t("harness.installNote")}</p>
              </details>
              <Show when={login.data}>
                {(result) => (
                  <article class={appearance.root()}>
                    <div class={appearance.body({ class: "flex flex-col gap-2 space-y-0" })}>
                      <p>{language.t(`harness.login.${result().state}`)}</p>
                      <Show when={result().code}>
                        <code>{result().code}</code>
                      </Show>
                      <Show when={result().url}>
                        {(url) => (
                          <a class="text-ink-link underline" href={url()} target="_blank" rel="noopener noreferrer">
                            {language.t("harness.openSignIn")}
                          </a>
                        )}
                      </Show>
                      <Show when={result().detail}>
                        <p role="status">{result().detail}</p>
                      </Show>
                      <p class="text-ink-muted">{language.t("harness.remoteLogin")}</p>
                      <Show when={result().state === "pending"}>
                        <Show when={result().driver === "claude"}>
                          <label>
                            {language.t("harness.authorizationCode")}
                            <input
                              type="password"
                              autocomplete="off"
                              class={input({ size: "sm", class: "mt-1 w-full" })}
                              value={state.code}
                              onInput={(event) => setState("code", event.currentTarget.value)}
                            />
                          </label>
                          <Button
                            variant="outline"
                            disabled={state.busy || !state.code.trim()}
                            onClick={() =>
                              void action(async () => {
                                await api().loginAnswer({
                                  providerInstanceID: result().providerInstanceID || "claude-default",
                                  code: state.code,
                                })
                                if (lifetime.active) setState("code", "")
                              })
                            }
                          >
                            {language.t("harness.submitCode")}
                          </Button>
                        </Show>
                        <Button
                          variant="outline"
                          disabled={state.busy}
                          onClick={() =>
                            void action(async () => {
                              await api().cancelLogin({
                                providerInstanceID:
                                  result().providerInstanceID || `${result().driver}-default`,
                              })
                              if (lifetime.active) void login.refetch()
                            })
                          }
                        >
                          {language.t("harness.cancelSignIn")}
                        </Button>
                      </Show>
                    </div>
                  </article>
                )}
              </Show>
            </Tabs.Content>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

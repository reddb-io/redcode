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
    directory: "",
    model: "",
    backgroundWait: false,
    executable: { claude: "", codex: "" },
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
    login: undefined as Harness.Driver | undefined,
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
    queryFn: ({ signal }) => api().loginStatus({ driver: state.login! }, { signal }),
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
                      directory: directory(),
                      ...(state.model.trim() ? { model: state.model.trim() } : {}),
                      ...(state.backgroundWait ? { backgroundWait: true } : {}),
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
                      value={state.driver}
                      options={(["redcode", "codex", "claude"] as const).map((driver) => ({
                        value: driver,
                        label: language.t(`harness.driver.${driver}`),
                      }))}
                      onChange={(value) => {
                        if (value === "redcode" || value === "claude" || value === "codex")
                          setState({ driver: value, model: "" })
                      }}
                    />
                  </label>
                  <Show when={state.driver !== "redcode"}>
                    <label>
                      {language.t("harness.model")}
                      <input
                        list={`harness-models-${ServerConnection.key(props.server)}`}
                        class={input({ size: "sm", class: "mt-1 w-full" })}
                        value={state.model}
                        onInput={(event) => setState("model", event.currentTarget.value)}
                      />
                      <datalist id={`harness-models-${ServerConnection.key(props.server)}`}>
                        <For each={query.data?.providers.find((provider) => provider.driver === state.driver)?.models}>
                          {(model) => <option value={model.id}>{model.label}</option>}
                        </For>
                      </datalist>
                    </label>
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
              <div class="grid gap-4 @2xl/harness-workspace:grid-cols-2">
                <Key each={query.data?.providers} by="driver">
                  {(provider) => (
                    <article class={appearance.root()} aria-label={language.t(`harness.driver.${provider().driver}`)}>
                      <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
                        <h3 class="text-13-medium">{language.t(`harness.driver.${provider().driver}`)}</h3>
                        <div class="flex flex-wrap items-center gap-2">
                          <span
                            class={badge({ tone: provider().installed ? "success" : "warning", variant: "tinted" })}
                          >
                            {language.t(provider().installed ? "harness.installed" : "harness.notInstalled")}
                          </span>
                          <span class="text-caption text-ink-muted">
                            {provider().version || language.t("harness.notChecked")}
                          </span>
                        </div>
                        <Show when={provider().authenticated !== undefined}>
                          <p>{language.t(provider().authenticated ? "harness.signedIn" : "harness.signedOut")}</p>
                        </Show>
                        <label>
                          {language.t("harness.executable")}
                          <input
                            class={input({ size: "sm", class: "mt-1 w-full" })}
                            value={state.executable[provider().driver] || provider().executable}
                            onInput={(event) => setState("executable", provider().driver, event.currentTarget.value)}
                          />
                        </label>
                        <div class="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={state.busy}
                            onClick={() =>
                              void action(() =>
                                api().configure({
                                  driver: provider().driver,
                                  executable: state.executable[provider().driver] || provider().executable,
                                }),
                              )
                            }
                          >
                            {language.t("harness.saveAndCheck")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={state.busy}
                            onClick={() => void action(() => api().probe({ driver: provider().driver }))}
                          >
                            {language.t("harness.check")}
                          </Button>
                          <Show when={!provider().installed}>
                            <Button
                              variant="outline"
                              disabled={state.busy}
                              onClick={() => void action(() => api().install({ driver: provider().driver }))}
                            >
                              {language.t("harness.install")}
                            </Button>
                          </Show>
                          <Button
                            variant="outline"
                            disabled={state.busy || !provider().installed}
                            onClick={() =>
                              void action(async () => {
                                await api().login({ driver: provider().driver })
                                if (lifetime.active) {
                                  setState("login", provider().driver)
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
                </Key>
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
                                await api().loginAnswer({ driver: "claude", code: state.code })
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
                              await api().cancelLogin({ driver: result().driver })
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

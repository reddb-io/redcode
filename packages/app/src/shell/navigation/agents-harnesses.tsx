import { Harness } from "@opencode/schema/harness"
import { useSearchParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { textarea } from "@reddb-io/design-system/contracts/textarea"
import { Button } from "@opencode/ui/button"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import { useLanguage } from "@/runtime/i18n/language"
import { uuid } from "@/runtime/persistence/uuid"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"

export default function AgentHarnesses(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const [params, setParams] = useSearchParams()
  const api = () => global.ensureServerCtx(props.server).sdk.api.harness
  const connected = () => global.ensureServerCtx(props.server).sdk.connection.status() === "connected"
  const [state, setState] = createStore({
    driver: "codex" as Harness.Driver,
    directory: "",
    model: "",
    executable: { claude: "", codex: "" },
    busy: false,
    error: "",
    runID: "",
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
    enabled: connected() && !!state.runID,
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
        if (state.runID) void detail.refetch()
      }
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) setState("busy", false)
    }
  }
  const directory = () => state.directory || (typeof params.directory === "string" ? params.directory : "")
  return (
    <div class="flex flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <p class="text-ink-muted">{language.t("harness.description")}</p>
      <Show when={query.isError || !connected()}>
        <p role="alert">{language.t("harness.unavailable")}</p>
      </Show>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <div class="grid gap-4 lg:grid-cols-2">
        <Key each={query.data?.providers} by="driver">
          {(provider) => (
            <article class={appearance.root()} aria-label={language.t(`harness.driver.${provider().driver}`)}>
              <div class={appearance.body({ class: "flex flex-col gap-3" })}>
                <h3 class="text-13-medium">{language.t(`harness.driver.${provider().driver}`)}</h3>
                <p>{provider().version || language.t("harness.notChecked")}</p>
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
      <p class="text-ink-muted">{language.t("harness.installNote")}</p>
      <Show when={login.data}>
        {(result) => (
          <article class={appearance.root()}>
            <div class={appearance.body({ class: "flex flex-col gap-2" })}>
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
      <form
        class={appearance.root()}
        onSubmit={(event) => {
          event.preventDefault()
          void action(async () => {
            const run = await api().open({
              driver: state.driver,
              directory: directory(),
              ...(state.model.trim() ? { model: state.model.trim() } : {}),
            })
            if (lifetime.active) setState({ runID: run.id, stopped: false, delivery: "queue" })
          })
        }}
      >
        <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2" })}>
          <h3 class="text-13-medium sm:col-span-2">{language.t("harness.start")}</h3>
          <label>
            {language.t("harness.provider")}
            <select
              aria-label={language.t("harness.provider")}
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.driver}
              onChange={(event) => setState("driver", event.currentTarget.value === "claude" ? "claude" : "codex")}
            >
              <option value="codex">{language.t("harness.driver.codex")}</option>
              <option value="claude">{language.t("harness.driver.claude")}</option>
            </select>
          </label>
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
          <label class="sm:col-span-2">
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
            {language.t("harness.start")}
          </Button>
        </div>
      </form>
      <article class={appearance.root()}>
        <div class={appearance.body({ class: "flex flex-col gap-3" })}>
          <h3 class="text-13-medium">{language.t("harness.runs")}</h3>
          <For each={query.data?.runs}>
            {(run) => (
              <Button
                variant="ghost"
                onClick={() => {
                  setState({
                    runID: run.id,
                    stopped: false,
                    answers: {},
                    prompt: "",
                    delivery: "queue",
                    promptID: uuid(),
                  })
                }}
              >
                <span class="min-w-0 truncate">
                  {language.t(`harness.driver.${run.driver}`)} · {run.directory} ·{" "}
                  {language.t(`harness.state.${run.state}`)}
                </span>
              </Button>
            )}
          </For>
        </div>
      </article>
      <Show when={detail.isError}>
        <p role="alert">{language.t("harness.runUnavailable")}</p>
      </Show>
      <Show when={detail.data}>
        {(result) => (
          <article class={appearance.root()}>
            <div class={appearance.body({ class: "flex flex-col gap-3" })}>
              <h3 class="text-13-medium">
                {language.t(`harness.driver.${result().run.driver}`)} ·{" "}
                {language.t(`harness.state.${result().run.state}`)}
              </h3>
              <p class="break-all text-ink-muted">{result().run.directory}</p>
              <Show when={result().run.detail}>
                <p role="status">{result().run.detail}</p>
              </Show>
              <p>{language.plural("harness.queued", result().run.queued, { count: result().run.queued })}</p>
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
                    state.busy || !["interrupted", "failed"].includes(result().run.state) || !result().run.nativeID
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
                            api().answer({ runID: state.runID, request: request().id, allow: false, answers: {} }),
                          )
                        }
                      >
                        {language.t("harness.decline")}
                      </Button>
                    </div>
                  </section>
                )}
              </Key>
              <div
                role="log"
                aria-label={language.t("harness.output")}
                class="max-h-96 overflow-auto rounded border border-v2-border-base p-3"
              >
                <For each={result().events}>
                  {(event) => (
                    <span class={event.kind === "text" ? "whitespace-pre-wrap break-words" : "block text-ink-muted"}>
                      {event.text}
                    </span>
                  )}
                </For>
              </div>
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
            </div>
          </article>
        )}
      </Show>
    </div>
  )
}

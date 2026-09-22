import { useSettingsDialog } from "./settings-dialog"
import { showToast } from "@/utils/toast"
import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@reddb-io/redcode-ui/button"
import { IntelligenceClient } from "@reddb-io/redcode-client"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { useModels } from "@/context/models"
import { authTokenFromCredentials } from "@/utils/server"
import { SettingsServerScope, SettingsServerPicker } from "./settings-server-picker"

export function SettingsIntelligence() {
  return (
    <SettingsServerScope>
      <IntelligenceForm />
    </SettingsServerScope>
  )
}
function IntelligenceForm() {
  const language = useLanguage()
  const server = useServerSDK()
  const platform = usePlatform()
  const models = useModels()
  const openProviders = useSettingsDialog("providers")
  const api = () => {
    const http = server().server.http
    return IntelligenceClient.make({
      baseUrl: http.url,
      fetch: platform.fetch,
      headers: http.password
        ? { Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
        : undefined,
    })
  }
  const [state, set] = createStore({
    settings: { enabled: false, onboarding: "pending" } as Intelligence.Settings,
    environment: "",
    principal: "",
    fast: "",
    ...IntelligenceClient.evaluatorPreset(),
    key: "",
    busy: false,
    loaded: false,
    evaluations: [] as Intelligence.Evaluation[],
    operation: "" as "" | Intelligence.Operation,
    decision: "" as "" | Intelligence.Evaluation["decision"],
    historyOffset: 0,
    historyMore: false,
    message: "",
    discovered: [] as { id: string; name: string }[],
    evaluators: [] as Intelligence.EvaluatorOption[],
  })
  const value = (ref?: Model.Ref) => (ref ? `${ref.providerID}/${ref.id}` : "")
  const ref = (text: string) => ({
    providerID: Provider.ID.make(text.slice(0, text.indexOf("/"))),
    id: Model.ID.make(text.slice(text.indexOf("/") + 1)),
  })
  const evaluator = (): Intelligence.Evaluator => ({
    transport: state.transport,
    baseURL: state.baseURL,
    model: state.model,
    ...(state.settings.evaluator?.baseURL === state.baseURL && state.settings.evaluator.transport === state.transport
      ? { credentialID: state.settings.evaluator.credentialID }
      : {}),
  })
  const probe = () => ({ evaluator: evaluator(), ...(state.key ? { apiKey: state.key } : {}) })
  const run = async (action: () => Promise<void>) => {
    set("busy", true)
    set("message", "")
    await action().catch(() => set("message", language.t("settings.intelligence.error")))
    set("busy", false)
  }
  const loadHistory = async (reset: boolean) => {
    const offset = reset ? 0 : state.historyOffset
    const evaluations = await api().history({
      ...(state.operation ? { operation: state.operation } : {}),
      ...(state.decision ? { decision: state.decision } : {}),
      limit: 20,
      offset,
    })
    set("evaluations", reset ? evaluations : [...state.evaluations, ...evaluations])
    set("historyOffset", offset + evaluations.length)
    set("historyMore", evaluations.length === 20)
  }
  createEffect(() => {
    const client = api()
    let active = true
    onCleanup(() => {
      active = false
    })
    set("loaded", false)
    set("key", "")
    void run(async () => {
      const result = await client.get()
      if (!active) return
      set("settings", result.settings)
      set("environment", result.environment)
      set("evaluators", result.evaluators)
      set("principal", value(result.settings.principal))
      set("fast", value(result.settings.fast))
      set("transport", result.settings.evaluator?.transport ?? IntelligenceClient.evaluatorPreset().transport)
      set("baseURL", result.settings.evaluator?.baseURL ?? IntelligenceClient.evaluatorPreset().baseURL)
      set("model", result.settings.evaluator?.model ?? IntelligenceClient.evaluatorPreset().model)
      set("loaded", true)
      const history = await client.history({ limit: 20 })
      if (active) {
        set("evaluations", history)
        set("historyOffset", history.length)
        set("historyMore", history.length === 20)
      }
    })
  })
  const save = () =>
    run(async () => {
      if (!state.principal) {
        set("message", language.t("intelligence.setupRequired"))
        return
      }
      const client = api()
      const serverURL = server().url
      const input = {
        settings: {
          enabled: true,
          onboarding: "completed" as const,
          principal: ref(state.principal),
          ...(state.fast ? { fast: ref(state.fast) } : {}),
          evaluator: evaluator(),
        },
        ...(state.key ? { apiKey: state.key } : {}),
      }
      const refs = [input.settings.principal, ...(input.settings.fast ? [input.settings.fast] : [])]
      for (const model of refs.filter((model, index) => index === 0 || value(model) !== value(refs[0]))) {
        const check = await client.probeModel(model)
        if (!check.ok) {
          set("message", check.message)
          return
        }
      }
      const check = await client.probe({ evaluator: input.settings.evaluator, apiKey: input.apiKey })
      if (!check.ok) {
        set("message", check.message)
        return
      }
      if (server().url !== serverURL) return
      const settings = await client.save(input)
      if (server().url !== serverURL) return
      set("settings", settings)
      server().intelligence.accept(settings)
      set("key", "")
      set("message", language.t("settings.intelligence.saved"))
    })
  const inputClass = "w-full rounded-md border border-border-base bg-background-base p-2 text-text-strong"
  return (
    <div class="flex flex-col gap-5 p-6 max-w-2xl">
      <SettingsServerPicker />
      <h2 class="text-16-medium text-text-strong">{language.t("settings.intelligence.title")}</h2>
      <p class="text-12-regular text-text-weak">
        {language.t("settings.intelligence.environment", { environment: state.environment || server().url })}
      </p>
      <p>{language.t("settings.intelligence.description")}</p>
      <Button variant="secondary" onClick={openProviders}>
        {language.t("settings.intelligence.connect")}
      </Button>
      <fieldset disabled={state.busy || !state.loaded} class="flex flex-col gap-4">
        <For each={["principal", "fast"] as const}>
          {(role) => (
            <label class="flex flex-col gap-1">
              <span>
                {language.t(role === "principal" ? "settings.intelligence.principal" : "settings.intelligence.fast")}
              </span>
              <select class={inputClass} value={state[role]} onChange={(event) => set(role, event.currentTarget.value)}>
                <option value="">
                  {language.t(role === "principal" ? "settings.intelligence.select" : "settings.intelligence.reuse")}
                </option>
                <For each={models.list().filter((model) => model.capabilities.protocol !== "systemone")}>
                  {(model) => (
                    <option value={`${model.provider.id}/${model.id}`}>
                      {model.provider.name} / {model.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
          )}
        </For>
        <label class="flex flex-col gap-1">
          <span>{language.t("settings.intelligence.connection")}</span>
          <select
            class={inputClass}
            value={state.transport}
            onChange={(event) => {
              const selected = state.evaluators.find(
                (option) => option.evaluator.transport === event.currentTarget.value,
              )
              if (!selected) return
              set("transport", selected.evaluator.transport)
              set("baseURL", selected.evaluator.baseURL)
              set("model", selected.evaluator.model)
              set("settings", (settings) => ({ ...settings, evaluator: selected.evaluator }))
              set("key", "")
              set("discovered", [])
            }}
          >
            <For each={state.evaluators}>
              {(option) => (
                <option value={option.evaluator.transport}>
                  {option.configured ? "Connected · " : ""}
                  {option.name}
                </option>
              )}
            </For>
          </select>
        </label>
        <Show when={state.transport === "opencode-zen"}>
          <p class="text-12-regular text-text-weak">{language.t("settings.intelligence.zenNotice")}</p>
          <a
            href="https://opencode.ai/zen"
            target="_blank"
            rel="noreferrer"
            class="text-text-interactive-base underline"
          >
            {language.t("settings.intelligence.connectZen")}
          </a>
        </Show>
        <label class="flex flex-col gap-1">
          <span>{language.t("settings.intelligence.url")}</span>
          <input
            class={inputClass}
            value={state.baseURL}
            onInput={(event) => set("baseURL", event.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span>{language.t("settings.intelligence.key")}</span>
          <input
            type="password"
            autocomplete="off"
            class={inputClass}
            value={state.key}
            onInput={(event) => set("key", event.currentTarget.value)}
          />
        </label>
        <Button
          variant="secondary"
          onClick={() =>
            void run(async () => {
              const result = await api().discover(probe())
              set("discovered", result.models)
              if (result.manual) set("message", language.t("settings.intelligence.manual"))
            })
          }
        >
          {language.t("settings.intelligence.discover")}
        </Button>
        <label class="flex flex-col gap-1">
          <span>{language.t("settings.intelligence.evaluator")}</span>
          <input
            class={inputClass}
            list="system-one-models"
            value={state.model}
            onInput={(event) => set("model", event.currentTarget.value)}
          />
          <datalist id="system-one-models">
            <For each={state.discovered}>{(model) => <option value={model.id}>{model.name}</option>}</For>
          </datalist>
        </label>
        <p class="text-12-regular text-text-weak">{language.t("settings.intelligence.disclosure")}</p>
        <Button onClick={() => void save()}>{language.t("settings.intelligence.activate")}</Button>
      </fieldset>
      <Show when={state.loaded}>
        <details>
          <summary>{language.t("settings.intelligence.history")}</summary>
          <div class="flex gap-2 py-2">
            <select
              class={inputClass}
              value={state.operation}
              onChange={(event) => {
                set(
                  "operation",
                  Intelligence.Operation.literals.find((operation) => operation === event.currentTarget.value) ?? "",
                )
                void run(() => loadHistory(true))
              }}
            >
              <option value="">All operations</option>
              <For each={Intelligence.Operation.literals}>
                {(operation) => (
                  <option value={operation}>{language.t(`settings.intelligence.operation.${operation}`)}</option>
                )}
              </For>
            </select>
            <select
              class={inputClass}
              value={state.decision}
              onChange={(event) => {
                set(
                  "decision",
                  Intelligence.Decision.literals.find((decision) => decision === event.currentTarget.value) ?? "",
                )
                void run(() => loadHistory(true))
              }}
            >
              <option value="">All decisions</option>
              <For each={Intelligence.Decision.literals}>
                {(decision) => (
                  <option value={decision}>{language.t(`settings.intelligence.decision.${decision}`)}</option>
                )}
              </For>
            </select>
          </div>
          <For each={state.evaluations}>
            {(evaluation) => (
              <div class="border-b border-border-base py-2 text-12-regular">
                <div>
                  {language.t(`settings.intelligence.operation.${evaluation.operation}`)} ·{" "}
                  {language.t(`settings.intelligence.decision.${evaluation.decision}`)} · {evaluation.model}
                </div>
                <For each={evaluation.issues}>{(issue) => <p class="text-icon-warning-base">{issue}</p>}</For>
                <Show when={(evaluation.attempt ?? 0) > 0}>
                  <div>Corrective review attempt {evaluation.attempt}</div>
                </Show>
                <div>
                  {language.t("settings.intelligence.usage", {
                    input: evaluation.usage.input_tokens,
                    output: evaluation.usage.output_tokens,
                    duration: evaluation.duration,
                  })}
                </div>
                <details>
                  <summary>{language.t("settings.intelligence.details")}</summary>
                  <For each={Object.entries(evaluation.answers)}>
                    {([id, answer]) => (
                      <div class="py-1">
                        <strong>{id}</strong>
                        <Show when={answer.type === "noul"}>
                          : noul {(answer.type === "noul" ? answer.noul : 0).toFixed(2)}
                        </Show>
                        <Show when={answer.type === "choice"}>
                          : {answer.type === "choice" ? answer.choice : ""} · confidence{" "}
                          {answer.type === "choice" ? answer.confidence.toFixed(2) : ""}
                        </Show>
                        <Show when={answer.type === "score"}>
                          : score {answer.type === "score" ? answer.score.toFixed(2) : ""} · confidence{" "}
                          {answer.type === "score" ? answer.confidence.toFixed(2) : ""}
                        </Show>
                        <Show when={answer.type !== "noul"}>
                          <div class="text-text-weak">
                            {Object.entries(answer.type === "noul" ? {} : answer.probabilities)
                              .map(([level, probability]) => `${level}: ${(probability * 100).toFixed(0)}%`)
                              .join(" · ")}
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </details>
              </div>
            )}
          </For>
          <Show when={state.historyMore}>
            <Button variant="secondary" onClick={() => void run(() => loadHistory(false))}>
              Load more
            </Button>
          </Show>
        </details>
      </Show>
      <Show when={state.busy}>
        <p role="status">{language.t("settings.intelligence.checking")}</p>
      </Show>
      <Show when={state.message}>
        <p role="status">{state.message}</p>
      </Show>
    </div>
  )
}

/** Configuration is required for execution; navigation and provider setup stay available. */
export function IntelligenceOnboarding() {
  const server = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const configure = useSettingsDialog("intelligence")
  const offered = new Set<string>()
  createEffect(() => {
    const http = server().server.http
    if (offered.has(http.url)) return
    offered.add(http.url)
    const api = IntelligenceClient.make({
      baseUrl: http.url,
      fetch: platform.fetch,
      headers: http.password
        ? { Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
        : undefined,
    })
    void api
      .get()
      .then((result) => {
        if (
          (result.settings.enabled && result.settings.principal && result.settings.evaluator) ||
          server().url !== http.url
        )
          return
        showToast({
          title: language.t("settings.intelligence.title"),
          description: language.t("intelligence.setupDescription"),
          persistent: true,
          actions: [
            {
              label: language.t("settings.intelligence.configure"),
              onClick: configure,
            },
          ],
        })
      })
      .catch(() => {})
  })
  return null
}

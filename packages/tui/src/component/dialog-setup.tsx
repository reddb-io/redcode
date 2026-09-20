import { batch, onMount, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { IntelligenceClient } from "@reddb-io/redcode-client"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogProvider } from "./dialog-provider"

type Step = "welcome" | "principal" | "fast" | "transport" | "url" | "key" | "models" | "manual" | "confirm"
type Scope = "all" | "system-one" | "system-two"
type ModelChoice = Model.Ref | "connect" | "reuse"

export function createDialogSetupState(resume?: { settings: Intelligence.Settings; step: "principal" | "fast" }) {
  return createStore({
    step: (resume?.step ?? "welcome") as Step,
    scope: "all" as Scope,
    settings: resume?.settings ?? ({ enabled: false, onboarding: "pending" } as Intelligence.Settings),
    key: "",
    busy: false,
    loaded: !!resume,
    environment: "",
    models: [] as { id: string; name: string }[],
    evaluators: [] as Intelligence.EvaluatorOption[],
  })
}

export function DialogSetup(
  props: {
    state?: ReturnType<typeof createDialogSetupState>
    onModelSelected?: (model: { providerID: string; modelID: string }) => void
  } = {},
) {
  const sdk = useSDK()
  const sync = useSync()
  const local = props.onModelSelected ? undefined : useLocal()
  const dialog = useDialog()
  const toast = useToast()
  const api = IntelligenceClient.make({ baseUrl: sdk.url, fetch: sdk.fetch, headers: sdk.headers })
  const setup = props.state ?? createDialogSetupState()
  const [state, set] = setup
  if (!state.environment) set("environment", sdk.url)
  const fail = () => {
    set("busy", false)
    toast.show({
      variant: "error",
      message: "Setup failed. Check the connection and retry; your previous settings are preserved.",
      duration: 6000,
    })
  }
  onMount(() => {
    api
      .get()
      .then((result) => {
        if (state.step === "welcome") set("settings", result.settings)
        set("environment", result.environment)
        set("evaluators", result.evaluators)
        set("loaded", true)
      })
      .catch(fail)
  })
  const connect = (resume: "welcome" | "principal" | "fast") =>
    dialog.replace(() => (
      <DialogProvider
        onConnected={() => {
          set("step", resume)
          dialog.replace(() => <DialogSetup state={setup} onModelSelected={props.onModelSelected} />)
        }}
      />
    ))
  const options = (): DialogSelectOption<ModelChoice>[] => [
    ...(state.step === "fast" && state.settings.principal
      ? [
          {
            title: "Reuse System Two principal",
            value: "reuse" as const,
            description: `${state.settings.principal.providerID}/${state.settings.principal.id}`,
            category: "Recommended",
          },
        ]
      : []),
    ...sync.data.provider.flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.capabilities.protocol !== "systemone")
        .map((model) => ({
          title: model.name,
          value: { providerID: Provider.ID.make(provider.id), id: Model.ID.make(model.id) },
          category: provider.name,
        })),
    ),
    { title: "Choose or connect provider…", value: "connect" as const, category: "Providers" },
  ]
  const evaluator = () => state.settings.evaluator!
  const finish = async () => {
    set("busy", true)
    const probe = { evaluator: evaluator(), ...(state.key ? { apiKey: state.key } : {}) }
    for (const model of [state.settings.principal, state.settings.fast].filter(
      (model, index, list) => model && (index === 0 || JSON.stringify(model) !== JSON.stringify(list[0])),
    )) {
      if (model && !(await api.probeModel(model)).ok) return fail()
    }
    const checked = await api.probe(probe)
    if (!checked.ok) {
      set("busy", false)
      toast.show({ variant: "error", message: checked.message, duration: 8000 })
      return
    }
    await api.save({
      settings: { ...state.settings, enabled: true, onboarding: "completed" },
      ...(state.key ? { apiKey: state.key } : {}),
    })
    const principal = state.settings.principal
    if (principal) {
      const selected = { providerID: principal.providerID, modelID: principal.id }
      if (props.onModelSelected) props.onModelSelected(selected)
      else local!.model.set(selected, { recent: true })
    }
    set("key", "")
    dialog.clear()
    toast.show({ variant: "success", message: "Global System One and System Two setup saved", duration: 4000 })
  }
  return (
    <Switch>
      <Match when={state.step === "welcome"}>
        <DialogSelect
          title={state.loaded ? `Global intelligence · ${state.environment}` : "Loading global intelligence setup…"}
          locked={!state.loaded}
          options={[
            {
              title: "Configure all roles",
              value: "all",
              description: "Principal, transformations and semantic evaluator",
            },
            ...(state.settings.onboarding === "completed" && state.settings.principal && state.settings.evaluator
              ? [
                  {
                    title: "Change System Two models",
                    value: "system-two",
                    description: `Principal: ${state.settings.principal.providerID}/${state.settings.principal.id}`,
                  },
                  {
                    title: "Change System One evaluator",
                    value: "system-one",
                    description: `${state.settings.evaluator.transport}/${state.settings.evaluator.model}`,
                  },
                ]
              : []),
            { title: "Choose or connect a generative provider", value: "connect" },
            { title: "Later", value: "defer", description: "Keep existing behavior" },
            { title: "Disable semantic evaluation", value: "disable" },
          ]}
          onSelect={(option) => {
            if (!state.loaded) return
            if (option.value === "connect") return connect("welcome")
            if (option.value === "defer" || option.value === "disable") {
              void api
                .save({
                  settings: {
                    ...state.settings,
                    enabled: option.value === "disable" ? false : state.settings.enabled,
                    onboarding: "deferred",
                  },
                })
                .then(() => dialog.clear())
                .catch(fail)
              return
            }
            if (option.value === "system-one") {
              set("scope", "system-one")
              set("step", "transport")
              return
            }
            set("scope", option.value === "system-two" ? "system-two" : "all")
            set("step", "principal")
          }}
        />
      </Match>
      <Match when={state.step === "principal" || state.step === "fast"}>
        <DialogSelect
          title={
            state.step === "principal"
              ? "1/3 · System Two principal"
              : "2/3 · System Two transformations (may reuse principal)"
          }
          options={options()}
          onSelect={(option) => {
            if (option.value === "connect") return connect(state.step === "fast" ? "fast" : "principal")
            const role = state.step === "principal" ? "principal" : "fast"
            const model = option.value === "reuse" ? undefined : option.value
            set((current) => ({
              ...current,
              settings: { ...current.settings, [role]: model },
              step: role === "principal" ? "fast" : current.scope === "system-two" ? "confirm" : "transport",
            }))
          }}
        />
      </Match>
      <Match when={state.step === "transport"}>
        <DialogSelect
          title="3/3 · System One connection"
          current={state.settings.evaluator?.transport ?? "opencode-zen"}
          options={state.evaluators.map((option) => ({
            title: option.name,
            value: option.evaluator.transport,
            description: option.configured ? "Configured connection" : undefined,
            category: option.configured ? "Connected" : "Available",
          }))}
          onSelect={(option) => {
            const selected = state.evaluators.find((item) => item.evaluator.transport === option.value)!
            batch(() => {
              set("settings", (settings) => ({
                ...settings,
                evaluator:
                  settings.evaluator?.transport === option.value
                    ? {
                        ...settings.evaluator,
                        ...(settings.evaluator.baseURL === selected.evaluator.baseURL && selected.evaluator.credentialID
                          ? { credentialID: selected.evaluator.credentialID }
                          : {}),
                      }
                    : selected.evaluator,
              }))
              set("step", "url")
            })
          }}
        />
      </Match>
      <Match when={state.step === "url"}>
        <DialogPrompt
          title="System One API base URL"
          value={evaluator().baseURL}
          onConfirm={(value) => {
            batch(() => {
              set("settings", (settings) => ({
                ...settings,
                evaluator: {
                  ...evaluator(),
                  baseURL: value,
                  credentialID: evaluator().baseURL === value ? evaluator().credentialID : undefined,
                },
              }))
              set("step", "key")
            })
          }}
        />
      </Match>
      <Match when={state.step === "key"}>
        <DialogPrompt
          title={
            evaluator().transport === "opencode-zen" ? "Zen API key — https://opencode.ai/zen" : "System One API key"
          }
          placeholder={
            evaluator().credentialID
              ? "Empty reuses the configured provider connection"
              : evaluator().transport === "opencode-zen"
                ? "Empty reuses an OpenCode Zen connection, OPENCODE_API_KEY, or public free access"
                : "API key, or empty to use the server environment"
          }
          busy={state.busy}
          onConfirm={(value) => {
            set("key", value)
            set("busy", true)
            void api
              .discover({ evaluator: evaluator(), ...(value ? { apiKey: value } : {}) })
              .then((result) => {
                set("models", result.models)
                set("busy", false)
                set("step", result.models.length ? "models" : "manual")
              })
              .catch(fail)
          }}
        />
      </Match>
      <Match when={state.step === "models"}>
        <DialogSelect
          title="System One evaluator"
          current={evaluator().model}
          options={[
            { title: evaluator().model, value: evaluator().model },
            ...state.models
              .filter((model) => model.id !== evaluator().model)
              .map((model) => ({ title: model.name, value: model.id })),
            { title: "Enter model manually", value: "manual" },
          ]}
          onSelect={(option) => {
            if (option.value === "manual") return set("step", "manual")
            batch(() => {
              set("settings", (settings) => ({ ...settings, evaluator: { ...evaluator(), model: option.value } }))
              set("step", "confirm")
            })
          }}
        />
      </Match>
      <Match when={state.step === "manual"}>
        <DialogPrompt
          title="System One model"
          value={evaluator().model}
          onConfirm={(value) => {
            batch(() => {
              set("settings", (settings) => ({ ...settings, evaluator: { ...evaluator(), model: value } }))
              set("step", "confirm")
            })
          }}
        />
      </Match>
      <Match when={state.step === "confirm"}>
        <DialogSelect
          title={state.busy ? "Testing configuration…" : "Save global intelligence setup"}
          locked={state.busy}
          options={[
            {
              title: "Test and save",
              value: "save",
              description:
                evaluator().transport === "opencode-zen"
                  ? "Sends sources to Zen. Free offer is temporary; no automatic paid fallback."
                  : "Sources and candidates will be sent to the selected evaluator",
            },
            {
              title: state.scope === "system-two" ? "Back to System Two models" : "Back to connection",
              value: "back",
            },
          ]}
          onSelect={(option) => {
            if (state.busy) return
            if (option.value === "back") return set("step", state.scope === "system-two" ? "principal" : "transport")
            void finish().catch(fail)
          }}
        />
      </Match>
    </Switch>
  )
}

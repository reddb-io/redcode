import { batch, createEffect, on, onCleanup, onMount, Switch, Match } from "solid-js"
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
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogProvider } from "./dialog-provider"
import { modeBadge, originCategory, originDescription, originIndex, routerLabel } from "../util/model-origin"

type Step = "mode" | "principal" | "fast" | "transport" | "url" | "key" | "models" | "manual" | "confirm"
type Scope = "all" | "system-one" | "system-two"
type ModelChoice = Model.Ref | { provider: string } | "connect" | "reuse" | "continue" | "change"
type TransportChoice = Intelligence.Evaluator["transport"] | "continue" | "detected"

export function createDialogSetupState(resume?: {
  settings: Intelligence.Settings
  step: "mode" | "principal" | "fast"
  reasoning?: Intelligence.Reasoning
}) {
  return createStore({
    step: (resume?.step ?? "mode") as Step,
    scope: "all" as Scope,
    reasoning: resume?.reasoning ?? resume?.settings.reasoning ?? ("single" as Intelligence.Reasoning),
    // The --reasoning flag overrides the saved mode for the current run only.
    flag: false,
    // A saved S2 principal is offered as "Continue with…" until the user asks to change it.
    changing: false,
    settings: resume?.settings ?? ({ enabled: false, onboarding: "pending" } as Intelligence.Settings),
    key: "",
    busy: false,
    loaded: !!resume,
    environment: "",
    providerID: "",
    models: [] as { id: string; name: string }[],
    evaluators: [] as Intelligence.EvaluatorOption[],
    router: undefined as Intelligence.DetectedRouter | undefined,
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
  const abort = new AbortController()
  let active = true
  const api = IntelligenceClient.make({
    baseUrl: sdk.url,
    fetch: sdk.fetch,
    headers: sdk.headers,
    signal: abort.signal,
  })
  onCleanup(() => {
    active = false
    abort.abort()
  })
  const setup = props.state ?? createDialogSetupState()
  const [state, set] = setup
  if (!state.environment) set("environment", sdk.url)
  const fail = () => {
    if (!active) return
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
        if (!active) return
        // Older servers omit `effective`; an enabled evaluator there means dual.
        const effective = result.effective ?? {
          reasoning:
            result.settings.reasoning ?? (result.settings.enabled && result.settings.evaluator ? "dual" : "single"),
          source: "config" as const,
        }
        batch(() => {
          // Resumed states (provider connection round-trips) keep the choices made so far.
          if (!state.loaded) {
            set("settings", result.settings)
            set("reasoning", effective.reasoning)
          }
          set("flag", effective.source === "flag")
          set("environment", result.environment)
          set("evaluators", result.evaluators)
          set("router", result.router)
          set("loaded", true)
        })
      })
      .catch(fail)
  })
  const connect = (resume: "principal" | "fast") =>
    dialog.replace(() => (
      <DialogProvider
        onConnected={(providerID) => {
          batch(() => {
            set("providerID", providerID)
            set("step", resume)
          })
          dialog.replace(() => <DialogSetup state={setup} onModelSelected={props.onModelSelected} />)
        }}
      />
    ))
  const generative = (provider: (typeof sync.data.provider)[number]) =>
    Object.values(provider.models).filter((model) => model.capabilities.protocol !== "systemone")
  const activeProvider = () => {
    const current = local?.model.current()
    const preferred = [state.providerID, current?.providerID, state.settings.principal?.providerID]
      .filter((providerID, index, list): providerID is string => !!providerID && list.indexOf(providerID) === index)
      .map((providerID) => sync.data.provider.find((provider) => provider.id === providerID))
      .find((provider) => provider && generative(provider).length > 0)
    return preferred ?? sync.data.provider.find((provider) => generative(provider).length > 0)
  }
  const label = (ref: Model.Ref) => {
    const provider = sync.data.provider.find((item) => item.id === ref.providerID)
    return `${provider?.name ?? ref.providerID} / ${provider?.models[ref.id]?.name ?? ref.id}`
  }
  const sessionModel = () => {
    const current = local?.model.current()
    if (!current) return undefined
    return { providerID: Provider.ID.make(current.providerID), id: Model.ID.make(current.modelID) }
  }
  const options = (): DialogSelectOption<ModelChoice>[] => {
    const principal = state.settings.principal
    if (state.step === "principal" && principal && !state.changing)
      return [
        {
          title: `Continue with ${label(principal)}`,
          value: "continue",
          description: state.settings.fast ? `Transformations: ${label(state.settings.fast)}` : undefined,
        },
        { title: "Change System Two model…", value: "change" },
      ]
    const provider = activeProvider()
    const index = originIndex(sync.data.provider)
    // Every connected provider is listed above the active provider's models so switching stays visible.
    return [
      ...(state.step === "fast" && principal
        ? [
            {
              title: "Reuse System Two principal",
              value: "reuse" as const,
              description: label(principal),
              category: "Recommended",
            },
          ]
        : []),
      ...sync.data.provider.flatMap((item) => {
        const total = generative(item).length
        if (!total) return []
        return [
          {
            title: item.name,
            value: { provider: item.id },
            description: [
              `${total} model${total === 1 ? "" : "s"}`,
              ...(item.id === provider?.id ? ["current"] : []),
              // The connection kind, unless the provider's name already says it.
              ...[routerLabel(item) ?? "direct"].filter((kind) => kind !== item.name),
            ].join(" · "),
            category: "Providers",
          },
        ]
      }),
      { title: "Connect another provider…", value: "connect" as const, category: "Providers" },
      ...(provider
        ? generative(provider)
            .map((model) => ({
              title: model.name,
              value: { providerID: Provider.ID.make(provider.id), id: Model.ID.make(model.id) },
              description: originDescription(index, provider, model),
              footer: modeBadge(model),
              // A router's models are grouped per upstream provider, like the model picker.
              category:
                routerLabel(provider) && model.upstream ? originCategory(provider, model) : `${provider.name} models`,
            }))
            .toSorted((a, b) => a.category.localeCompare(b.category))
        : []),
    ]
  }
  let select: DialogSelectRef<ModelChoice> | undefined
  let confirm: DialogSelectRef<string> | undefined
  // Providers sit above the models, so the cursor lands on the saved model or the provider's first model
  // (the fast step starts on reusing the principal).
  createEffect(
    on([() => state.step, () => state.changing, () => activeProvider()?.id], ([step], previous) => {
      if (step !== "principal" && step !== "fast") return
      if (step === "fast" && previous?.[0] !== "fast" && state.settings.principal) return select?.moveTo("reuse")
      const models = options().flatMap((option) => (isModel(option.value) ? [option.value] : []))
      const saved = step === "principal" ? [state.settings.principal, sessionModel()] : [state.settings.fast]
      const target =
        models.find((model) => saved.some((ref) => ref?.providerID === model.providerID && ref.id === model.id)) ??
        models[0]
      if (target) select?.moveTo(target)
    }),
  )
  // Numbered stages follow the chosen flow; S1 sub-steps (URL, key, model) share the S1 stage.
  const stages = () => [
    "mode",
    ...(state.scope === "system-one" ? [] : ["s2"]),
    ...(state.reasoning === "dual" && state.scope !== "system-two" ? ["s1"] : []),
  ]
  const title = (stage: "s1" | "s2", text: string) => `${stages().indexOf(stage) + 1}/${stages().length} · ${text}`
  const modelStepTitle = () => {
    const provider = activeProvider()
    const role = title("s2", state.step === "principal" ? "S2 principal" : "S2 transformations")
    return `${role}${provider ? ` · ${provider.name}` : ""}`
  }
  const afterSystemTwo = (): Step =>
    state.reasoning === "single" || state.scope === "system-two" ? "confirm" : "transport"
  const transportOptions = (): DialogSelectOption<TransportChoice>[] => [
    // A connected RedRouter that serves System One comes first: it shares the provider's key.
    ...(state.router?.evaluator
      ? [
          {
            title: `Use RedRouter ${routerName(state.router)} (detected)`,
            value: "detected" as const,
            description: `${state.router.evaluator.model} · shares the provider connection`,
            category: "Detected",
          },
        ]
      : []),
    ...(state.settings.evaluator
      ? [
          {
            title: `Continue with ${state.settings.evaluator.transport}/${state.settings.evaluator.model}`,
            value: "continue" as const,
            category: "Current",
          },
        ]
      : []),
    ...state.evaluators.map((option) => ({
      title: option.name,
      value: option.evaluator.transport,
      description: option.configured ? "Configured connection" : undefined,
      category: option.configured ? "Connected" : "Available",
    })),
  ]
  // A failed probe leaves the cursor on the option that changes the failing role.
  const failed = (fix: "s2" | "back", message: string) => {
    set("busy", false)
    toast.show({ variant: "error", message, duration: 8000 })
    confirm?.moveTo(fix)
  }
  const finish = async () => {
    set("busy", true)
    // Single reasoning keeps a saved S1 evaluator untouched (runtime ignores it) but never probes it.
    const evaluator = state.reasoning === "dual" ? state.settings.evaluator : undefined
    const apiKey = evaluator && state.key ? { apiKey: state.key } : {}
    const models = [
      { role: "S2 model", ref: state.settings.principal },
      { role: "S2 transformations model", ref: state.settings.fast },
    ].filter(
      (item, index, list) => item.ref && (index === 0 || JSON.stringify(item.ref) !== JSON.stringify(list[0]?.ref)),
    )
    for (const model of models) {
      if (!model.ref) continue
      const checked = await api.probeModel(model.ref)
      if (!active) return
      if (checked.ok) continue
      // "Generative connection failed (HTTP 400): …" reads as "S2 model <name> failed (HTTP 400): …".
      const reason = checked.message.replace(/^Generative connection failed/, "failed")
      return failed("s2", `${model.role} ${label(model.ref)}${reason.startsWith("failed") ? " " : ": "}${reason}`)
    }
    if (evaluator) {
      const checked = await api.probe({ evaluator, ...apiKey })
      if (!active) return
      if (!checked.ok) return failed("back", checked.message)
    }
    await api.save({
      settings: { ...state.settings, reasoning: state.reasoning, enabled: true, onboarding: "completed" },
      ...apiKey,
    })
    if (!active) return
    await local?.intelligence.refresh()
    const principal = state.settings.principal
    if (principal) {
      const selected = { providerID: principal.providerID, modelID: principal.id }
      if (props.onModelSelected) props.onModelSelected(selected)
      else local!.model.set(selected, { recent: true })
    }
    set("key", "")
    dialog.clear()
    toast.show({
      variant: "success",
      message: evaluator ? "Global S1 and S2 setup saved" : "Single reasoning saved: S2 only",
      duration: 4000,
    })
  }
  return (
    <Switch>
      <Match when={state.step === "mode"}>
        <DialogSelect
          title={
            state.loaded
              ? `Global intelligence${state.flag ? ` · --reasoning ${state.reasoning}` : ""} · ${state.environment}`
              : "Loading global intelligence setup…"
          }
          locked={!state.loaded}
          current={state.reasoning}
          options={[
            {
              title: "Simple — one model",
              value: "single",
              description: "S2 only; completion checks report S1 as not verified",
            },
            {
              title: "Dual — S1 classifies and validates, S2 executes",
              value: "dual",
              description: "Adds the S1 evaluator to every semantic gate",
            },
            ...(state.settings.onboarding === "completed" && state.settings.principal
              ? [
                  {
                    title: "Change System Two models",
                    value: "system-two",
                    description: `Principal: ${label(state.settings.principal)}`,
                  },
                ]
              : []),
            ...(state.settings.onboarding === "completed" && state.settings.evaluator
              ? [
                  {
                    title: "Change System One evaluator",
                    value: "system-one",
                    description: `${state.settings.evaluator.transport}/${state.settings.evaluator.model}`,
                  },
                ]
              : []),
            { title: "Close setup", value: "close", description: "Keep the current setup" },
          ]}
          onSelect={(option) => {
            if (!state.loaded) return
            if (option.value === "close") return dialog.clear()
            if (option.value === "system-one")
              return set((current) => ({ ...current, scope: "system-one", reasoning: "dual", step: "transport" }))
            if (option.value === "system-two")
              return set((current) => ({ ...current, scope: "system-two", changing: true, step: "principal" }))
            set((current) => ({
              ...current,
              scope: "all",
              reasoning: option.value === "dual" ? "dual" : "single",
              changing: false,
              step: "principal",
            }))
          }}
        />
      </Match>
      <Match when={state.step === "principal" || state.step === "fast"}>
        <DialogSelect
          title={modelStepTitle()}
          ref={(ref) => (select = ref)}
          current={state.step === "principal" ? (state.settings.principal ?? sessionModel()) : undefined}
          options={options()}
          onSelect={(option) => {
            // Choosing a provider stays on this step and lists that provider's models.
            if (typeof option.value === "object" && "provider" in option.value)
              return set("providerID", option.value.provider)
            if (option.value === "connect") return connect(state.step === "fast" ? "fast" : "principal")
            if (option.value === "change") return set("changing", true)
            // Continuing keeps the saved transformations model, or reuse of the principal.
            if (option.value === "continue") return set("step", afterSystemTwo())
            const role = state.step === "principal" ? "principal" : "fast"
            const model = option.value === "reuse" ? undefined : option.value
            set((current) => ({
              ...current,
              providerID: model?.providerID ?? current.providerID,
              settings: { ...current.settings, [role]: model },
              step: role === "principal" && current.reasoning === "dual" ? "fast" : afterSystemTwo(),
            }))
          }}
        />
      </Match>
      <Match when={state.step === "transport"}>
        <DialogSelect
          title={title("s1", "S1 connection")}
          current={state.settings.evaluator ? "continue" : state.router?.evaluator ? "detected" : "opencode-zen"}
          options={transportOptions()}
          onSelect={(option) => {
            if (option.value === "continue") return set("step", "confirm")
            // The router's own S1 model at its connected address, with the provider's credential.
            const detected = state.router?.evaluator
            if (option.value === "detected" && detected)
              return batch(() => {
                set("settings", (settings) => ({ ...settings, evaluator: detected }))
                set("key", "")
                set("step", "confirm")
              })
            const selected = state.evaluators.find((item) => item.evaluator.transport === option.value)
            if (!selected) return
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
      <Match when={state.step === "url" && state.settings.evaluator}>
        {(evaluator) => (
          <DialogPrompt
            title={title("s1", "S1 API base URL")}
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
        )}
      </Match>
      <Match when={state.step === "key" && state.settings.evaluator}>
        {(evaluator) => (
          <DialogPrompt
            title={
              evaluator().transport === "opencode-zen"
                ? "Zen API key — https://opencode.ai/zen"
                : title("s1", "S1 API key")
            }
            placeholder={
              evaluator().credentialID
                ? "Empty reuses the configured provider connection"
                : evaluator().transport === "opencode-zen"
                  ? "Empty reuses an OpenCode Zen connection, OPENCODE_API_KEY, or public free access"
                  : "API key, or empty to use the server environment"
            }
            value={state.key}
            busy={state.busy}
            onConfirm={(value) => {
              set("key", value)
              set("busy", true)
              void api
                .discover({ evaluator: evaluator(), ...(value ? { apiKey: value } : {}) })
                .then((result) => {
                  if (!active) return
                  set("models", result.models)
                  set("busy", false)
                  set("step", result.models.length ? "models" : "manual")
                })
                .catch(fail)
            }}
          />
        )}
      </Match>
      <Match when={state.step === "models" && state.settings.evaluator}>
        {(evaluator) => (
          <DialogSelect
            title={title("s1", "S1 evaluator")}
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
        )}
      </Match>
      <Match when={state.step === "manual" && state.settings.evaluator}>
        {(evaluator) => (
          <DialogPrompt
            title={title("s1", "S1 model")}
            value={evaluator().model}
            onConfirm={(value) => {
              batch(() => {
                set("settings", (settings) => ({ ...settings, evaluator: { ...evaluator(), model: value } }))
                set("step", "confirm")
              })
            }}
          />
        )}
      </Match>
      <Match when={state.step === "confirm"}>
        <DialogSelect
          title={state.busy ? "Testing configuration…" : "Save global intelligence setup"}
          locked={state.busy}
          ref={(ref) => (confirm = ref)}
          options={[
            {
              title: "Test and save",
              value: "save",
              // Its own line: the dialog is too narrow to follow the title.
              details: [
                state.reasoning === "single"
                  ? "S2 only; a saved S1 stays unused"
                  : state.settings.evaluator?.transport === "opencode-zen"
                    ? "Sends sources to Zen; free offer, no paid fallback"
                    : `Sends sources to ${state.settings.evaluator?.transport ?? "S1"}`,
              ],
            },
            ...(afterSystemTwo() === "transport" ? [{ title: "Back to S1 connection", value: "back" }] : []),
            ...(state.scope === "system-one" ? [] : [{ title: "Change S2 model", value: "s2" }]),
          ]}
          onSelect={(option) => {
            if (state.busy) return
            if (option.value === "back") return set("step", "transport")
            if (option.value === "s2") return set((current) => ({ ...current, changing: true, step: "principal" }))
            void finish().catch(fail)
          }}
        />
      </Match>
    </Switch>
  )
}

function isModel(value: ModelChoice): value is Model.Ref {
  return typeof value === "object" && "id" in value
}

/** A detected router by its instance name, else the address it answers at. */
function routerName(router: Intelligence.DetectedRouter) {
  return router.detection.instanceID ?? URL.parse(router.baseURL)?.host ?? router.baseURL
}

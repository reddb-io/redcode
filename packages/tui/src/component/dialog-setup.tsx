import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { IntelligenceClient } from "@reddb-io/redcode-client"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { Router } from "@reddb-io/redcode-schema/router"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogProvider } from "./dialog-provider"
import { errorMessage } from "../util/error"
import {
  flatOffers,
  keyRoleLabel,
  modeBadge,
  originCategory,
  originDescription,
  originIndex,
  resolveModel,
  routerLabel,
} from "../util/model-origin"

type Step = "mode" | "principal" | "fast" | "evaluator" | "connection" | "url" | "key" | "manual" | "confirm"
type Scope = "all" | "system-one" | "system-two"
type ModelChoice =
  | Model.Ref
  | { recommended: Model.Ref }
  | { provider: string }
  | "connect"
  | "reuse"
  | "continue"
  | "change"
type EvaluatorChoice = { evaluator: Intelligence.Evaluator } | "continue" | "loading" | "retry" | "manual"

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
    // The RedRouter's System One catalog, read when the S1 picker opens.
    discovery: "idle" as "idle" | "loading" | "ready" | "failed",
    discoveryError: "",
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
  const { theme } = useTheme()
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
  // A pinned offer of a flat model is listed under that model once its offers are shown.
  const generative = (provider: (typeof sync.data.provider)[number]) =>
    Object.values(provider.models).filter((model) => model.capabilities.protocol !== "systemone" && !model.pinOf)
  // Flat models whose offers are listed under them, keyed `provider/model`.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const flatKey = (value: ModelChoice | undefined) => {
    if (!value || typeof value !== "object" || !("id" in value)) return undefined
    const model = sync.data.provider.find((item) => item.id === value.providerID)?.models[value.id]
    if (model?.flat) return `${value.providerID}/${model.id}`
    if (model?.pinOf) return `${value.providerID}/${model.pinOf}`
    return undefined
  }
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
    // A saved ref may hold a router alias (e.g. an id a router renamed); resolve it to the model
    // the provider currently lists before reading its display name.
    const resolved = resolveModel(provider, ref.id)
    const model = resolved ? provider?.models[resolved.modelID] : undefined
    return `${provider?.name ?? ref.providerID} · ${model?.name ?? ref.id}`
  }
  const sessionModel = () => {
    const current = local?.model.current()
    if (!current) return undefined
    return { providerID: Provider.ID.make(current.providerID), id: Model.ID.make(current.modelID) }
  }
  // The connected RedRouter's recommended model for a role, when that router lists it.
  const recommendation = (role: "default" | "fast") => {
    const router = state.router
    const pick = router?.recommended?.[role]
    const provider = sync.data.provider.find((item) => item.id === router?.providerID)
    const found = pick ? resolveModel(provider, pick.id) : undefined
    if (!pick || !provider || !found) return undefined
    return {
      pick,
      provider,
      ref: { providerID: Provider.ID.make(provider.id), id: Model.ID.make(found.modelID) },
    }
  }
  const stepRecommendation = () =>
    state.step === "principal" || state.step === "fast"
      ? recommendation(state.step === "principal" ? "default" : "fast")
      : undefined
  // Memoized so the cursor effect below reruns only when the recommended model changes, not on every
  // router or provider update.
  const recommendedID = createMemo(() => stepRecommendation()?.ref.id)
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
    const recommended = stepRecommendation()
    // Every connected provider is listed above the active provider's models so switching stays visible.
    return [
      ...(recommended
        ? [
            {
              title: `Recommended: ${recommended.pick.name}`,
              value: { recommended: recommended.ref },
              // Detail lines: the dialog is too narrow to follow the title with the origin and reason.
              details: [
                [`via ${routerLabel(recommended.provider) ?? "RedRouter"}`, recommended.pick.provider.name]
                  .filter(Boolean)
                  .join(Router.HOP_SEPARATOR),
                ...wrap(recommended.pick.reason, 50),
              ],
              category: "Recommended",
            },
          ]
        : []),
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
            // An expanded flat model lists the offers that can be pinned right under it; picking one
            // saves its pin id, never the offer id, which can be the flat id itself.
            .flatMap((option) => {
              const model = provider.models[option.value.id]
              if (!model?.flat || !expanded().has(`${provider.id}/${model.id}`)) return [option]
              return [
                option,
                ...flatOffers(provider, model).flatMap((row) =>
                  row.pin
                    ? [
                        {
                          title: `  ↳ ${row.route}`,
                          // Switched off for the flat model: greyed out, but its pin id still routes to it.
                          titleView: row.off ? (
                            <span style={{ fg: theme.textMuted }}>{`  ↳ ${row.route}`}</span>
                          ) : undefined,
                          value: { providerID: Provider.ID.make(provider.id), id: Model.ID.make(row.pin) },
                          description: [row.detail, ...(row.offer.free ? ["free"] : [])].filter(Boolean).join(" · "),
                          footer: undefined,
                          category: option.category,
                        },
                      ]
                    : [],
                ),
              ]
            })
        : []),
    ]
  }
  let select: DialogSelectRef<ModelChoice> | undefined
  let confirm: DialogSelectRef<string> | undefined
  // Providers sit above the models, so the cursor lands on the router's recommendation, else the saved
  // model or the provider's first model (the fast step starts on reusing the principal). Switching
  // provider lands on that provider's models instead.
  createEffect(
    on(
      [() => state.step, () => state.changing, () => activeProvider()?.id, recommendedID],
      ([step, changing, , recommended], previous) => {
        if (step !== "principal" && step !== "fast") return
        const entered = !previous || previous[0] !== step || previous[1] !== changing || previous[3] !== recommended
        const pick = stepRecommendation()
        if (entered && pick) return select?.moveTo({ recommended: pick.ref })
        if (step === "fast" && previous?.[0] !== "fast" && state.settings.principal) return select?.moveTo("reuse")
        const models = options().flatMap((option) => (isModel(option.value) ? [option.value] : []))
        const saved = step === "principal" ? [state.settings.principal, sessionModel()] : [state.settings.fast]
        const target =
          models.find((model) => saved.some((ref) => ref?.providerID === model.providerID && ref.id === model.id)) ??
          models[0]
        if (target) select?.moveTo(target)
      },
    ),
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
    state.reasoning === "single" || state.scope === "system-two" ? "confirm" : "evaluator"
  // The RedRouter whose System One models the picker lists: the detected one, else a configured
  // RedRouter connection. Both carry the provider's credential.
  const routerEvaluator = () =>
    state.router?.evaluator ??
    state.evaluators.find((option) => option.configured && option.evaluator.transport === "red-router")?.evaluator
  const discoverRouter = () => {
    const evaluator = routerEvaluator()
    if (!evaluator) return
    set("discovery", "loading")
    api
      .discover({ evaluator })
      .then((result) => {
        if (!active) return
        batch(() => {
          set("models", result.models)
          set("discovery", "ready")
        })
      })
      .catch((error) => {
        if (!active) return
        batch(() => {
          set("discoveryError", errorMessage(error))
          set("discovery", "failed")
        })
      })
  }
  createEffect(
    on([() => state.step, routerEvaluator], ([step, evaluator]) => {
      if (step === "evaluator" && evaluator && state.discovery === "idle") discoverRouter()
    }),
  )
  // Every System One model usable right now, without typing: the RedRouter's catalog (recommended
  // first), connected direct providers, then OpenCode Zen's free offer. Manual entry comes last.
  const evaluatorOptions = (): DialogSelectOption<EvaluatorChoice>[] => {
    const router = routerEvaluator()
    const detected = state.router
    const address = detected?.baseURL.replace(/\/+$/, "")
    const role = keyRoleLabel(
      sync.data.provider.find(
        (item) => typeof item.options?.baseURL === "string" && item.options.baseURL.replace(/\/+$/, "") === address,
      )?.router?.role,
    )
    const category = detected ? [`RedRouter ${routerName(detected)}`, role].filter(Boolean).join(" · ") : "RedRouter"
    const recommended = state.router?.recommended?.systemone?.id
    const failure =
      state.discovery === "failed"
        ? state.discoveryError
        : state.discovery === "ready" && !state.models.length
          ? "RedRouter lists no System One models. Connect a System One provider in the router."
          : undefined
    return [
      ...(state.settings.evaluator
        ? [
            {
              title: `Continue with ${evaluatorLabel(state.settings.evaluator)}`,
              value: "continue" as const,
              category: "Current",
            },
          ]
        : []),
      ...(!router
        ? []
        : failure !== undefined
          ? [{ title: "Retry RedRouter", value: "retry" as const, details: wrap(failure, 50), category }]
          : state.discovery !== "ready"
            ? [{ title: "Loading RedRouter System One models…", value: "loading" as const, category }]
            : state.models
                .toSorted((a, b) => Number(b.id === recommended) - Number(a.id === recommended))
                .map((model) => ({
                  // Discovery names the whole route: `RedRouter » RedRouter » OpenCode Zen · JEV 1.13`.
                  title: model.name,
                  value: { evaluator: { ...router, model: model.id } },
                  // The full routed id on its own line: the dialog is too narrow to follow the title.
                  details: [[model.id, ...(model.id === recommended ? ["recommended"] : [])].join(" · ")],
                  category,
                }))),
      ...state.evaluators
        .filter(
          (option) =>
            option.configured &&
            option.evaluator.transport !== "red-router" &&
            option.evaluator.transport !== "opencode-zen",
        )
        .map((option) => ({
          title: option.name,
          value: { evaluator: option.evaluator },
          description: option.evaluator.model,
          category: "Connected providers",
        })),
      ...state.evaluators
        .filter((option) => option.evaluator.transport === "opencode-zen")
        .map((option) => ({
          title: option.name,
          value: { evaluator: option.evaluator },
          description: "Free offer; no paid fallback",
          category: "OpenCode Zen",
        })),
      {
        title: "Enter model manually…",
        value: "manual" as const,
        description: "Any connection, address and model id",
        category: "Manual",
      },
    ]
  }
  // The cursor starts on the saved evaluator, else the first model offered (the RedRouter's recommendation).
  const evaluatorCurrent = (): EvaluatorChoice | undefined =>
    state.settings.evaluator
      ? "continue"
      : evaluatorOptions().flatMap((option) => (typeof option.value === "object" ? [option.value] : []))[0]
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
                    description: evaluatorLabel(state.settings.evaluator),
                  },
                ]
              : []),
            { title: "Close setup", value: "close", description: "Keep the current setup" },
          ]}
          onSelect={(option) => {
            if (!state.loaded) return
            if (option.value === "close") return dialog.clear()
            if (option.value === "system-one")
              return set((current) => ({ ...current, scope: "system-one", reasoning: "dual", step: "evaluator" }))
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
          actions={[
            {
              command: "model.dialog.offers",
              title: "Offers",
              hidden: !Object.values(activeProvider()?.models ?? {}).some((model) => model.flat),
              disabled: (option) => !flatKey(option?.value),
              onTrigger: (option) => {
                const key = flatKey(option.value)
                if (!key) return
                setExpanded((current) => {
                  const next = new Set(current)
                  if (!next.delete(key)) next.add(key)
                  return next
                })
              },
            },
          ]}
          onSelect={(option) => {
            // Choosing a provider stays on this step and lists that provider's models.
            if (typeof option.value === "object" && "provider" in option.value)
              return set("providerID", option.value.provider)
            if (option.value === "connect") return connect(state.step === "fast" ? "fast" : "principal")
            if (option.value === "change") return set("changing", true)
            // Continuing keeps the saved transformations model, or reuse of the principal.
            if (option.value === "continue") return set("step", afterSystemTwo())
            const role = state.step === "principal" ? "principal" : "fast"
            const model =
              option.value === "reuse"
                ? undefined
                : "recommended" in option.value
                  ? option.value.recommended
                  : option.value
            set((current) => ({
              ...current,
              providerID: model?.providerID ?? current.providerID,
              settings: { ...current.settings, [role]: model },
              step: role === "principal" && current.reasoning === "dual" ? "fast" : afterSystemTwo(),
            }))
          }}
        />
      </Match>
      <Match when={state.step === "evaluator"}>
        <DialogSelect
          title={title("s1", "S1 evaluator")}
          current={evaluatorCurrent()}
          options={evaluatorOptions()}
          onSelect={(option) => {
            if (option.value === "loading") return
            if (option.value === "continue") return set("step", "confirm")
            if (option.value === "retry") return discoverRouter()
            if (option.value === "manual") return set("step", "connection")
            // Each entry is a whole evaluator: transport, address, credential and model together.
            const evaluator = option.value.evaluator
            batch(() => {
              set("settings", (settings) => ({ ...settings, evaluator }))
              set("key", "")
              set("step", "confirm")
            })
          }}
        />
      </Match>
      <Match when={state.step === "connection"}>
        <DialogSelect
          title={title("s1", "S1 connection")}
          current={state.settings.evaluator?.transport ?? "opencode-zen"}
          options={state.evaluators.map((option) => ({
            title: TRANSPORT_NAMES[option.evaluator.transport] ?? option.evaluator.transport,
            value: option.evaluator.transport,
            description: option.configured ? "Configured connection" : undefined,
            category: option.configured ? "Connected" : "Available",
          }))}
          onSelect={(option) => {
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
            onConfirm={(value) => {
              batch(() => {
                set("key", value)
                set("step", "manual")
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
            ...(afterSystemTwo() === "evaluator" ? [{ title: "Back to S1 evaluator", value: "back" }] : []),
            ...(state.scope === "system-one" ? [] : [{ title: "Change S2 model", value: "s2" }]),
          ]}
          onSelect={(option) => {
            if (state.busy) return
            if (option.value === "back") return set("step", "evaluator")
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

/** A sentence as lines of at most `width` characters, broken between words. */
function wrap(text: string, width: number) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .reduce<string[]>((lines, word) => {
      const last = lines.at(-1)
      if (last !== undefined && `${last} ${word}`.length <= width) return [...lines.slice(0, -1), `${last} ${word}`]
      return [...lines, word]
    }, [])
}

/** A detected router by its instance name, else the address it answers at. */
function routerName(router: Intelligence.DetectedRouter) {
  return router.detection.instanceID ?? URL.parse(router.baseURL)?.host ?? router.baseURL
}

/** Display name for an S1 evaluator's transport, matching the "Provider · model" format used for S2. */
const TRANSPORT_NAMES: Record<Intelligence.Evaluator["transport"], string> = {
  "opencode-zen": "OpenCode Zen",
  openrouter: "OpenRouter",
  typesafe: "TypeSafe",
  "red-router": "RedRouter",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  vercel: "Vercel AI Gateway",
  vivgrid: "Vivgrid",
  "nano-gpt": "NanoGPT",
}
function evaluatorLabel(evaluator: Intelligence.Evaluator) {
  return `${TRANSPORT_NAMES[evaluator.transport] ?? evaluator.transport} · ${evaluator.model}`
}

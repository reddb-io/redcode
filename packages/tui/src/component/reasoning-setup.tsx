import type { IntelligenceEvaluator, IntelligenceSettings, ModelInfo, ProviderInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { firstConnectionFailure, type ConnectionFailure } from "@opencode/util/connection-failure"
import { DialogIntegration } from "./dialog-integration"
import { errorMessage } from "../util/error"
import { Router } from "@opencode/schema/router"
import { keyRoleLabel, modelDescription, modelLabel, modelRoute, offerDetails } from "../util/model-presentation"

export async function configureReasoning(
  context: Plugin.Context,
  saved: (settings: IntelligenceSettings) => void,
  resume?: { reasoning: "single" | "dual"; principal?: IntelligenceSettings["principal"] },
) {
  const api = context.client["server.intelligence"]
  const status = await api.status()
  const location = context.location ?? context.data.location.default()
  const models = (await context.client.model.list({ location })).data
    .filter(
      (model) => model.enabled && model.capabilities.output.includes("text") && !/(^|\/)jev(?:$|[-.])/i.test(model.id),
    )
    .toSorted((a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name))
  const providers = context.data.location.provider.list(location) ?? []
  if (!models.length) {
    context.ui.dialog.show(() => (
      <DialogIntegration
        onConnected={() => {
          void configureReasoning(context, saved).catch((error) =>
            context.ui.toast.show({ variant: "error", message: errorMessage(error) }),
          )
        }}
      />
    ))
    return
  }
  const reasoning =
    resume?.reasoning ??
    (await context.ui.dialog.select({
      title: `Reasoning mode${status.effective.source === "flag" ? " · overridden by REDCODE_REASONING" : ""}`,
      current: status.effective.reasoning,
      options: [
        { value: "single" as const, title: "Single · S2 generates", description: "S1 evaluation is off" },
        {
          value: "dual" as const,
          title: "Dual · S2 generates, S1 evaluates",
          description: "S1 checks work; unavailable evaluations remain visible",
        },
      ],
    }))
  if (!reasoning) return
  const resumedModel = models.find(
    (model) => model.providerID === resume?.principal?.providerID && model.id === resume?.principal?.id,
  )
  const currentFast = models.find(
    (model) => model.providerID === status.settings.fast?.providerID && model.id === status.settings.fast?.id,
  )
  const choice =
    resumedModel ??
    (await chooseModel(context, {
      role: "S2 principal · generates responses and does the work",
      models,
      providers,
      current: status.settings.principal,
      keepRoles: status.settings.onboarding === "completed",
      currentFast,
      recommended: status.router?.recommended?.default?.id,
      router: status.router?.providerID,
      onConnect: () => configureReasoning(context, saved, { reasoning }),
    }))
  const selected =
    choice === "keep-roles"
      ? models.find(
          (model) =>
            model.providerID === status.settings.principal?.providerID && model.id === status.settings.principal.id,
        )
      : choice
  if (!selected) return
  const principal = `${selected.providerID}/${selected.id}`
  const fast =
    choice === "keep-roles"
      ? currentFast
        ? "keep-fast"
        : "reuse-principal"
      : await context.ui.dialog.select({
          title: "S2 transformations · summaries and bounded text",
          current: currentFast ? "keep-fast" : "reuse-principal",
          options: [
            { value: "reuse-principal", title: "Reuse S2 principal", description: modelLabel(selected, providers) },
            ...(currentFast
              ? [
                  {
                    value: "keep-fast",
                    title: "Keep current transformations model",
                    description: modelLabel(currentFast, providers),
                  },
                ]
              : []),
            { value: "choose-fast", title: "Choose another model", description: "Select provider, then model" },
          ],
        })
  if (!fast) return
  const transformation =
    fast === "choose-fast"
      ? await chooseModel(context, {
          role: "S2 transformations · summaries and bounded text",
          models,
          providers,
          onConnect: () =>
            configureReasoning(context, saved, {
              reasoning,
              principal: { providerID: selected.providerID, id: selected.id },
            }),
        })
      : fast === "keep-fast"
        ? currentFast
        : undefined
  if (transformation === "keep-roles") return
  if (fast !== "reuse-principal" && !transformation) return
  const evaluator = reasoning === "dual" ? await chooseEvaluator(context, status) : undefined
  if (reasoning === "dual" && !evaluator) return
  const model = { providerID: selected.providerID, id: selected.id }
  const confirmed = await context.ui.dialog.confirm({
    title: "Test and save reasoning roles",
    message: `Mode: ${reasoning === "dual" ? "Dual" : "Single"}\nS2 principal: ${modelLabel(selected, providers)}\nS2 transformations: ${transformation ? modelLabel(transformation, providers) : "reuse principal"}\nS1 evaluator: ${evaluator ? `${evaluator.evaluator.transport}/${evaluator.evaluator.model}` : "off"}${evaluator ? "\nSources and candidates will be sent to S1." : ""}\nThe selected connections will be checked before saving.${status.effective.source === "flag" ? `\nREDCODE_REASONING=${status.environment} overrides the saved mode.` : ""}`,
  })
  if (!confirmed) return
  const checked = await checkConnections(context, [
    {
      role: `S2 principal ${modelLabel(selected, providers)}`,
      run: () =>
        context.client.generate.text(
          { prompt: "Reply with OK.", model, location },
          { signal: AbortSignal.timeout(30_000) },
        ),
    },
    ...(transformation && `${transformation.providerID}/${transformation.id}` !== principal
      ? [
          {
            role: `S2 transformations ${modelLabel(transformation, providers)}`,
            run: () =>
              context.client.generate.text(
                {
                  prompt: "Reply with OK.",
                  model: { providerID: transformation.providerID, id: transformation.id },
                  location,
                },
                { signal: AbortSignal.timeout(30_000) },
              ),
          },
        ]
      : []),
    ...(evaluator
      ? [
          {
            role: `S1 evaluator ${evaluator.evaluator.transport}/${evaluator.evaluator.model}`,
            run: () =>
              api.probe(evaluator, { signal: AbortSignal.timeout(30_000) }).then((check) => {
                if (!check.ok) throw new Error(check.message)
              }),
          },
        ]
      : []),
  ])
  if (!checked) return
  const settings = await api.save({
    settings: {
      ...status.settings,
      enabled: true,
      reasoning,
      onboarding: "completed",
      principal: model,
      fast:
        transformation && `${transformation.providerID}/${transformation.id}` !== principal
          ? { providerID: transformation.providerID, id: transformation.id }
          : undefined,
      ...(evaluator ? { evaluator: evaluator.evaluator } : {}),
    },
    ...(evaluator?.apiKey ? { apiKey: evaluator.apiKey } : {}),
  })
  saved(settings)
  context.ui.toast.show({
    variant: "success",
    message: reasoning === "dual" ? "S2 and S1 configured" : "S2 configured",
  })
}

async function chooseModel(
  context: Plugin.Context,
  input: {
    role: string
    models: ModelInfo[]
    providers: ProviderInfo[]
    current?: IntelligenceSettings["principal"]
    keepRoles?: boolean
    currentFast?: ModelInfo
    recommended?: string
    router?: string
    onConnect: () => Promise<void>
  },
) {
  const current = input.models.find(
    (model) => model.providerID === input.current?.providerID && model.id === input.current.id,
  )
  const groups = Object.groupBy(input.models, (model) => model.providerID)
  const provider = await context.ui.dialog.select({
    title: input.role,
    current: current ? (input.keepRoles ? "keep-roles" : "keep") : input.router,
    options: [
      ...(current && input.keepRoles
        ? [
            {
              value: "keep-roles",
              title: "Continue with current S2 setup",
              description: `${modelLabel(current, input.providers)} · transformations: ${input.currentFast ? modelLabel(input.currentFast, input.providers) : "reuse principal"}`,
              category: "Current",
            },
          ]
        : []),
      ...(current
        ? [
            {
              value: "keep",
              title: `Keep ${current.name}`,
              description: modelDescription(
                current,
                input.providers.find((item) => item.id === current.providerID),
              ),
              category: "Current",
            },
          ]
        : []),
      ...Object.entries(groups)
        .toSorted(
          ([left], [right]) =>
            Number(right === "red-router") - Number(left === "red-router") ||
            Number(right === "9router") - Number(left === "9router") ||
            left.localeCompare(right),
        )
        .map(([id, list]) => ({
          value: id,
          title: input.providers.find((item) => item.id === id)?.name ?? id,
          description: [
            `${Router.offerGroups(list ?? []).length} models`,
            keyRoleLabel(input.providers.find((item) => item.id === id)),
            id === input.router && input.recommended ? "recommended model available" : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          category: "Providers",
        })),
      { value: "connect", title: "Connect another provider…", category: "Providers" },
    ],
  })
  if (!provider) return
  if (provider === "keep-roles") return "keep-roles" as const
  if (provider === "keep") return current
  if (provider === "connect") {
    context.ui.dialog.show(() => (
      <DialogIntegration
        onConnected={() => {
          void input
            .onConnect()
            .catch((error) => context.ui.toast.show({ variant: "error", message: errorMessage(error) }))
        }}
      />
    ))
    return
  }
  // Models pinning one offer of a flat model are reached through that model's offers row.
  const offered = Router.offerGroups(groups[provider] ?? [])
  const chosen = await context.ui.dialog.select({
    title: `${input.role} · ${input.providers.find((item) => item.id === provider)?.name ?? provider}`,
    current:
      current?.providerID === provider
        ? current.pinOf
          ? `${OFFERS}${current.pinOf}`
          : current.id
        : input.router === provider
          ? input.recommended
          : undefined,
    options: offered
      .toSorted(
        (a, b) =>
          Number(b.model.id === input.recommended && b.model.providerID === input.router) -
            Number(a.model.id === input.recommended && a.model.providerID === input.router) ||
          a.model.name.localeCompare(b.model.name),
      )
      .flatMap((group) => {
        const model = group.model
        const category =
          model.id === input.recommended && model.providerID === input.router
            ? "Recommended"
            : modelRoute(
                model,
                input.providers.find((item) => item.id === model.providerID),
              )
        const option = {
          value: model.id,
          title: model.name,
          // Names differ between routed providers ("GLM-5.3 Max" against "GLM 5.3 Flash"), so the id is searchable too.
          searchText: model.id,
          description: modelDescription(
            model,
            input.providers.find((item) => item.id === model.providerID),
          ),
          category,
        }
        if (!group.offers.some((entry) => entry.model)) return [option]
        return [
          option,
          {
            value: `${OFFERS}${model.id}`,
            title: `  ▸ ${group.offers.length} offers`,
            searchText: model.id,
            description: "Pin one provider, price and route for this model",
            category,
          },
        ]
      }),
  })
  const group = offered.find((item) => `${OFFERS}${item.model.id}` === chosen)
  if (!group) return offered.find((item) => item.model.id === chosen)?.model
  const pinned = group.offers.flatMap((entry) => (entry.model ? [{ ...entry, model: entry.model }] : []))
  const unpinned = group.offers.length - pinned.length
  const offer = await context.ui.dialog.select({
    title: `${input.role} · ${group.model.name} offers`,
    current: current?.pinOf === group.model.id ? current.id : group.model.id,
    options: [
      {
        value: group.model.id,
        title: "Automatic · the router picks the first available offer",
        description: [group.model.id, ...(unpinned ? [`${unpinned} offers cannot be pinned`] : [])].join(" · "),
        category: "Route",
      },
      ...pinned.map((entry) => ({
        value: entry.model.id,
        title: Router.offerRoute(entry.offer),
        description: offerDetails(entry),
        category: "Offers",
      })),
    ],
  })
  return [group.model, ...pinned.map((entry) => entry.model)].find((model) => model.id === offer)
}

/** Value prefix of the row that opens a flat model's offers in the S2 model picker. */
const OFFERS = "offers:"

async function chooseEvaluator(
  context: Plugin.Context,
  status: Awaited<ReturnType<Plugin.Context["client"]["server.intelligence"]["status"]>>,
) {
  const location = context.location ?? context.data.location.default()
  const connected = new Set(
    (context.data.location.integration.list(location) ?? [])
      .filter((integration) => integration.connections.length > 0)
      .map((integration) => integration.id),
  )
  const options = [
    ...(status.settings.evaluator
      ? [
          {
            name: "Keep current S1 evaluator",
            evaluator: status.settings.evaluator,
            keep: true,
            direct: true,
            category: "Current",
          },
        ]
      : []),
    ...(status.router?.evaluator
      ? [
          {
            name: [
              "RedRouter",
              keyRoleLabel(
                (context.data.location.provider.list(location) ?? []).find(
                  (item) => item.id === status.router?.providerID,
                ),
              ),
              status.router.evaluator.model,
            ]
              .filter(Boolean)
              .join(" · "),
            evaluator: status.router.evaluator,
            keep: false,
            direct: true,
            category: "Connected",
          },
        ]
      : []),
    ...status.evaluators
      .filter((option) => option.evaluator.transport !== "red-router" || !status.router?.evaluator)
      .map((option) => ({
        name: `${option.name} · ${option.evaluator.model}`,
        evaluator: option.evaluator,
        keep: false,
        direct: connected.has(option.evaluator.transport),
        category: connected.has(option.evaluator.transport) ? "Connected" : "Other services",
      })),
  ]
  const index = await context.ui.dialog.select({
    title: "S1 evaluator · checks S2 work",
    options: options.map((option, index) => ({
      value: index,
      title: option.name,
      description: `${option.evaluator.transport} · ${option.evaluator.baseURL}`,
      category: option.category,
    })),
  })
  if (index === undefined) return
  const chosen = options[index]
  if (chosen.keep) return { evaluator: chosen.evaluator, apiKey: undefined }
  const baseURL = chosen.direct
    ? chosen.evaluator.baseURL
    : await context.ui.dialog.prompt({ title: "S1 API base URL", value: chosen.evaluator.baseURL })
  if (baseURL === undefined) return
  const apiKey = chosen.direct
    ? ""
    : await context.ui.dialog.prompt({
        title: "S1 API key",
        description: "Leave empty to reuse a saved credential or provider connection.",
      })
  if (apiKey === undefined) return
  const evaluator: IntelligenceEvaluator = {
    ...chosen.evaluator,
    baseURL: baseURL.trim(),
    // A credential selected for one endpoint must not follow an edited URL.
    credentialID: baseURL.trim() === chosen.evaluator.baseURL ? chosen.evaluator.credentialID : undefined,
  }
  const discovered = await context.client["server.intelligence"]
    .discover(
      { evaluator, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      { signal: AbortSignal.timeout(30_000) },
    )
    .catch((error) => {
      context.ui.toast.show({
        variant: "warning",
        message: `Model discovery failed: ${errorMessage(error)}. Enter a model ID to test it.`,
      })
      return undefined
    })
  const model = discovered?.models.length
    ? await context.ui.dialog.select({
        title: `S1 model · ${chosen.evaluator.transport}`,
        current: evaluator.model,
        options: [
          ...discovered.models
            .toSorted(
              (a, b) =>
                Number(b.id === evaluator.model) - Number(a.id === evaluator.model) || a.name.localeCompare(b.name),
            )
            .map((model) => ({
              value: model.id,
              title: model.name,
              description: model.id,
              category: model.id === evaluator.model ? "Recommended" : "Available",
            })),
          { value: "", title: "Enter model ID manually" },
        ],
      })
    : ""
  if (model === undefined) return
  const id = model || (await context.ui.dialog.prompt({ title: "S1 model ID", value: evaluator.model }))
  if (!id?.trim()) return
  return { evaluator: { ...evaluator, model: id.trim() }, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }
}

// Checks each role in order; a failure names the role and the reason and offers Retry, which reruns every check.
async function checkConnections(
  context: Plugin.Context,
  checks: { role: string; run: () => Promise<unknown> }[],
): Promise<boolean> {
  context.ui.toast.show({ variant: "info", message: "Checking reasoning connections…" })
  const failed = await firstConnectionFailure(checks)
  if (!failed) return true
  const retry = await context.ui.dialog.confirm({
    title: `${failed.role} failed`,
    message: `${failureReason(failed.failure)}${failed.failure.detail ? `\n${failed.failure.detail}` : ""}\nYour saved roles are unchanged.`,
    label: { confirm: "Retry", cancel: "Cancel" },
  })
  if (!retry) return false
  return checkConnections(context, checks)
}

function failureReason(failure: ConnectionFailure) {
  if (failure.kind === "credential")
    return `The credential was rejected${failure.status ? ` (HTTP ${failure.status})` : ""}. Reconnect the provider or enter another key.`
  if (failure.kind === "timeout") return "No answer within 30 seconds."
  if (failure.kind === "status") return `The server answered HTTP ${failure.status}.`
  if (failure.kind === "unreachable") return "The address could not be reached. Check the URL and your network."
  return "The connection check failed."
}

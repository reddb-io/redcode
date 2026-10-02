import type { IntelligenceEvaluator, IntelligenceSettings, ModelInfo, ProviderInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { firstConnectionFailure, type ConnectionFailure } from "@opencode/util/connection-failure"
import { IntegrationOrder } from "@opencode/util/integration-order"
import { DialogIntegration } from "./dialog-integration"
import { errorMessage } from "../util/error"
import { Router } from "@opencode/schema/router"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { keyRoleLabel, modelDescription, modelLabel, modelRoute, offerDetails } from "../util/model-presentation"

type SelectedModel = ModelInfo & { connection?: NonNullable<IntelligenceSettings["principal"]>["connection"] }

export async function configureReasoning(
  context: Plugin.Context,
  saved: (settings: IntelligenceSettings) => void,
  resume?: {
    reasoning?: "single" | "dual" | "observe"
    principal?: IntelligenceSettings["principal"]
    current?: IntelligenceSettings["principal"]
  },
) {
  const api = context.client["server.intelligence"]
  const status = await api.status()
  const location = context.location ?? context.data.location.default()
  const models = (await context.client.model.list({ location })).data
    .filter(
      (model) =>
        model.enabled &&
        model.type === undefined &&
        model.capabilities.output.includes("text") &&
        !Router.isJevEvaluator(model.id),
    )
    .toSorted((a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name))
  const providers = context.data.location.provider.list(location) ?? []
  const integrations = (await context.client.integration.list({ location })).data
  if (!models.length && !integrations.some((integration) => integration.connections.length)) {
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
        {
          value: "observe" as const,
          title: "Observe · S2 generates, S1 records",
          description: "Measure S1 without changing the response or tool selection",
        },
        { value: "single" as const, title: "Single · S2 generates", description: "S1 evaluation is off" },
        {
          value: "dual" as const,
          title: "Dual · S2 generates, S1 evaluates",
          description: "S1 checks work; unavailable evaluations remain visible",
        },
      ],
    }))
  if (!reasoning) return
  const resumed = models.find(
    (model) => model.providerID === resume?.principal?.providerID && model.id === resume?.principal?.id,
  )
  const resumedModel = resumed ? { ...resumed, connection: resume?.principal?.connection } : undefined
  const selected =
    resumedModel ??
    (await chooseModel(context, {
      role: "S2 principal",
      models,
      providers,
      current: status.settings.principal,
      reuse: resume?.current,
      recommended: status.router?.recommended?.default?.id,
      router: status.router?.providerID,
      onConnect: () => configureReasoning(context, saved, { reasoning, current: resume?.current }),
    }))
  if (!selected) return
  const principal = JSON.stringify([selected.providerID, selected.id, selected.connection])
  const evaluator = reasoning !== "single" ? await chooseEvaluator(context, status) : undefined
  if (reasoning !== "single" && !evaluator) return
  const available = (await context.client.model.list({ location })).data
  const currentFastModel = available.find(
    (model) =>
      model.enabled && model.providerID === status.settings.fast?.providerID && model.id === status.settings.fast?.id,
  )
  const currentFast = currentFastModel
    ? { ...currentFastModel, connection: status.settings.fast?.connection }
    : undefined
  const fast = await context.ui.dialog.select({
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
      { value: "choose-fast", title: "Choose another model", description: "Select connection, then model" },
    ],
  })
  if (!fast) return
  const transformation =
    fast === "choose-fast"
      ? await chooseModel(context, {
          role: "S2 transformations",
          models: available,
          providers,
          onConnect: () =>
            configureReasoning(context, saved, {
              reasoning,
              principal: { providerID: selected.providerID, id: selected.id, connection: selected.connection },
            }),
        })
      : fast === "keep-fast"
        ? currentFast
        : undefined
  if (fast !== "reuse-principal" && !transformation) return
  const model = { providerID: selected.providerID, id: selected.id, connection: selected.connection }
  const confirmed = await context.ui.dialog.confirm({
    title: "Test and save reasoning roles",
    message: `Mode: ${reasoning === "observe" ? "Observe" : reasoning === "dual" ? "Dual" : "Single"}\nS2 principal: ${modelLabel(selected, providers)}\nS2 transformations: ${transformation ? modelLabel(transformation, providers) : "reuse principal"}\nS1 evaluator: ${evaluator ? `${evaluator.evaluator.transport}/${evaluator.evaluator.model}` : "off"}${evaluator ? "\nSources and candidates will be sent to S1." : ""}\nThe selected connections will be checked before saving.${status.effective.source === "flag" ? `\nREDCODE_REASONING=${status.environment} overrides the saved mode.` : ""}`,
  })
  if (!confirmed) return
  const checked = await checkConnections(context, [
    {
      role: `S2 principal ${modelLabel(selected, providers)}`,
      run: () =>
        context.client.generate
          .text({ prompt: "Reply with OK.", model, location, check: true }, { signal: AbortSignal.timeout(30_000) })
          .then((result) => result.requests ?? []),
    },
    ...(transformation &&
    JSON.stringify([transformation.providerID, transformation.id, transformation.connection]) !== principal
      ? [
          {
            role: `S2 transformations ${modelLabel(transformation, providers)}`,
            run: () =>
              context.client.generate
                .text(
                  {
                    prompt: "Reply with OK.",
                    model: {
                      providerID: transformation.providerID,
                      id: transformation.id,
                      connection: transformation.connection,
                    },
                    location,
                    check: true,
                  },
                  { signal: AbortSignal.timeout(30_000) },
                )
                .then((result) => result.requests ?? []),
          },
        ]
      : []),
    ...(evaluator
      ? [
          {
            role: `S1 evaluator ${evaluator.evaluator.transport}/${evaluator.evaluator.model}`,
            run: () =>
              api.probe(evaluator, { signal: AbortSignal.timeout(30_000) }).then((check) => {
                if (check.endpoint) evaluator.evaluator = { ...evaluator.evaluator, endpoint: check.endpoint }
                if (!check.ok)
                  throw Object.assign(new Error(check.message), { requests: ConnectionCheck.requestsFrom(check) })
                return ConnectionCheck.requestsFrom(check)
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
        transformation &&
        JSON.stringify([transformation.providerID, transformation.id, transformation.connection]) !== principal
          ? { providerID: transformation.providerID, id: transformation.id, connection: transformation.connection }
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
    reuse?: IntelligenceSettings["principal"]
    recommended?: string
    router?: string
    onConnect: () => Promise<void>
  },
): Promise<SelectedModel | undefined> {
  const current = input.models.find(
    (model) => model.providerID === input.current?.providerID && model.id === input.current.id,
  )
  const location = context.location ?? context.data.location.default()
  const integrations = (await context.client.integration.list({ location })).data
  const connections = integrations.toSorted(IntegrationOrder.compare).flatMap((integration) => {
    const providers = input.providers.filter((provider) => (provider.integrationID ?? provider.id) === integration.id)
    const routes = providers.length
      ? providers.map((provider) => ({ id: provider.id, name: provider.name, provider }))
      : ["red-router", "9router"].includes(integration.id)
        ? [{ id: integration.id, name: integration.name, provider: undefined }]
        : []
    return routes.flatMap((route) =>
      integration.connections
        .filter((connection) => connection.type === "credential" || integration.connections[0]?.type === "env")
        .map((connection, index) => ({ ...route, connection, active: index === 0 })),
    )
  })
  const selectable = connections.toSorted((a, b) => Number(b.active) - Number(a.active))
  const reuse = input.models.find(
    (model) => model.providerID === input.reuse?.providerID && model.id === input.reuse.id,
  )
  const reuseConnection = reuse
    ? selectable.find(
        (item) =>
          item.id === reuse.providerID &&
          (input.reuse?.connection
            ? item.connection.type === input.reuse.connection.type &&
              (item.connection.type === "credential" && input.reuse.connection.type === "credential"
                ? item.connection.id === input.reuse.connection.id
                : item.connection.type === "env" &&
                  input.reuse.connection.type === "env" &&
                  item.connection.name === input.reuse.connection.name)
            : item.active),
      )
    : undefined
  const selected = await context.ui.dialog.select({
    title: `${input.role} · connection`,
    current: reuseConnection
      ? -2
      : Math.max(
          0,
          selectable.findIndex(
            (item) =>
              item.id === (current?.providerID ?? input.router) &&
              (input.current?.connection
                ? item.connection.type === input.current.connection.type &&
                  (item.connection.type === "credential" && input.current.connection.type === "credential"
                    ? item.connection.id === input.current.connection.id
                    : item.connection.type === "env" &&
                      input.current.connection.type === "env" &&
                      item.connection.name === input.current.connection.name)
                : item.active),
          ),
        ),
    options: [
      ...(reuse && reuseConnection
        ? [
            {
              value: -2,
              title: "Use current connection and model",
              description: `${modelLabel(reuse, input.providers)} · ${reuseConnection.connection.type === "credential" ? reuseConnection.connection.label : reuseConnection.connection.name}`,
            },
          ]
        : []),
      ...selectable.map((item, index) => ({
        value: index,
        title: item.connection.type === "credential" ? item.connection.label : item.connection.name,
        description: [
          item.name,
          item.active ? "active" : "activates account",
          item.active ? keyRoleLabel(item.provider) : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        category: "Connections",
      })),
      { value: -1, title: "Add connection…", category: "Actions" },
    ],
  })
  if (selected === undefined) return
  if (selected === -2 && reuse && reuseConnection)
    return {
      ...reuse,
      connection:
        input.reuse?.connection ??
        (reuseConnection.connection.type === "credential"
          ? { type: "credential", id: reuseConnection.connection.id }
          : { type: "env", name: reuseConnection.connection.name }),
    }
  if (selected === -1) {
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
  const connection = selectable[selected]
  const bind = (model: ModelInfo | undefined): SelectedModel | undefined =>
    model
      ? {
          ...model,
          connection:
            connection.connection.type === "credential"
              ? { type: "credential", id: connection.connection.id }
              : { type: "env", name: connection.connection.name },
        }
      : undefined
  const provider = connection.id
  if (!connection.active && connection.connection.type === "credential")
    await context.client.credential.activate({ credentialID: connection.connection.id })
  // Account switches invalidate the old catalog before the new discovery finishes.
  const deadline = Date.now() + 30_000
  const load = async (): Promise<ModelInfo[]> => {
    const models = (await context.client.model.list({ location })).data.filter(
      (model) =>
        model.providerID === provider &&
        model.enabled &&
        model.type === undefined &&
        model.capabilities.output.includes("text") &&
        !Router.isJevEvaluator(model.id),
    )
    if (models.length || Date.now() >= deadline) return models
    await new Promise((resolve) => setTimeout(resolve, 250))
    return load()
  }
  const available = await load()
  if (!available.length) {
    const retry = await context.ui.dialog.confirm({
      title: "No S2 models available",
      message: "This connection has no generative models. Check its catalog or choose another connection.",
      label: { confirm: "Choose connection", cancel: "Cancel" },
    })
    return retry ? chooseModel(context, input) : undefined
  }
  // Models pinning one offer of a flat model are reached through that model's offers row.
  const offered = Router.offerGroups(available)
  const chosen = await context.ui.dialog.select({
    title: `${input.role} · model · ${input.providers.find((item) => item.id === provider)?.name ?? provider}`,
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
  if (!group) return bind(offered.find((item) => item.model.id === chosen)?.model)
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
  return bind([group.model, ...pinned.map((entry) => entry.model)].find((model) => model.id === offer))
}

/** Value prefix of the row that opens a flat model's offers in the S2 model picker. */
const OFFERS = "offers:"

async function chooseEvaluator(
  context: Plugin.Context,
  status: Awaited<ReturnType<Plugin.Context["client"]["server.intelligence"]["status"]>>,
  retry?: number,
): Promise<{ evaluator: IntelligenceEvaluator; apiKey: undefined } | undefined> {
  const options = IntegrationOrder.evaluators(
    status.evaluators,
    (await context.client.integration.list({ location: context.location ?? context.data.location.default() })).data,
  )
  if (!options.length) {
    context.ui.toast.show({
      variant: "warning",
      message: "No S1 connection available. Connect a service that supports decisions, then run /dual again.",
    })
    return
  }
  const index =
    retry ??
    (await context.ui.dialog.select({
      title: "S1 evaluator · connection",
      current: options.findIndex((option) => option.configured),
      options: options.map((option, index) => ({
        value: index,
        title: option.name,
        description: `${option.evaluator.transport} · ${option.evaluator.baseURL}`,
        category: "Connections",
      })),
    }))
  if (index === undefined) return
  const chosen = options[index]
  context.ui.toast.show({ variant: "info", message: `Loading S1 models from ${chosen.name}…` })
  const discovered = await context.client["server.intelligence"]
    .discover({ evaluator: chosen.evaluator }, { signal: AbortSignal.timeout(30_000) })
    .catch((error) => {
      context.ui.toast.show({ variant: "warning", message: `Model discovery failed: ${errorMessage(error)}` })
      return undefined
    })
  if (!discovered?.models.length) {
    const action = await context.ui.dialog.select({
      title: discovered ? "No S1 models available" : "S1 catalog unavailable",
      options: [
        { value: "retry", title: "Refresh model list", description: "Check this connection again" },
        {
          value: "connection",
          title: "Choose another connection",
          description: "S1 requires models that support decisions",
        },
      ],
    })
    if (!action) return
    return chooseEvaluator(context, status, action === "retry" ? index : undefined)
  }
  const model = await context.ui.dialog.select({
    title: `S1 evaluator · model · ${chosen.name}`,
    current: chosen.evaluator.model,
    options: discovered.models
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((model) => ({
        value: model.id,
        title: model.name,
        description: model.id,
        category: "Decision models",
      })),
  })
  if (!model) return
  return {
    evaluator: {
      ...chosen.evaluator,
      model,
      endpoint: discovered.models.find((item) => item.id === model)?.endpoint ?? chosen.evaluator.endpoint,
    },
    apiKey: undefined,
  }
}

// Retry resumes at the failed role; successful checks do not make another paid probe.
async function checkConnections(
  context: Plugin.Context,
  checks: { role: string; run: () => Promise<readonly ConnectionCheck.Request[]> }[],
  completed: string[] = [],
  start = 0,
): Promise<boolean> {
  context.ui.toast.show({ variant: "info", message: "Checking reasoning connections…" })
  const failed = await firstConnectionFailure(
    checks.slice(start).map((check) => ({
      role: check.role,
      run: () =>
        check
          .run()
          .then((requests) => {
            completed.push(`${check.role}\n${ConnectionCheck.describe(requests)}`)
          })
          .catch((error: unknown) => {
            throw new Error(
              `${errorMessage(error)}\n\n${ConnectionCheck.describe(ConnectionCheck.requestsFrom(error))}`,
              { cause: error },
            )
          }),
    })),
  )
  if (!failed)
    return (
      (await context.ui.dialog.confirm({
        title: "Connection test results",
        message: completed.join("\n\n"),
        label: { confirm: "Save roles", cancel: "Cancel" },
      })) === true
    )
  const retry = await context.ui.dialog.confirm({
    title: `${failed.role.startsWith("S1") ? "S1 evaluator" : failed.role.startsWith("S2 principal") ? "S2 principal" : "S2 transformations"} connection failed`,
    message: `${completed.length ? `${completed.join("\n\n")}\n\n` : ""}${failed.role}\n${failureReason(failed.failure)}${failed.failure.detail ? `\n${failed.failure.detail}` : ""}\nYour saved roles are unchanged.`,
    label: { confirm: "Retry", cancel: "Cancel" },
  })
  if (!retry) return false
  return checkConnections(
    context,
    checks,
    completed,
    checks.findIndex((check) => check.role === failed.role),
  )
}

function failureReason(failure: ConnectionFailure) {
  if (failure.kind === "credential")
    return `The credential was rejected${failure.status ? ` (HTTP ${failure.status})` : ""}. Reconnect the provider or enter another key.`
  if (failure.kind === "timeout") return "No answer within 30 seconds."
  if (failure.kind === "status") return `The server answered HTTP ${failure.status}.`
  if (failure.kind === "unreachable") return "The address could not be reached. Check the URL and your network."
  return "The connection check failed."
}

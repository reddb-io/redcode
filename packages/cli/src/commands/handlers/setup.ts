import { autocomplete, intro, log, outro, select } from "@clack/prompts"
import {
  type IntelligenceEvaluator,
  type IntelligenceStatus,
  type ModelInfo,
  type OpenCodeClient,
  type ProviderInfo,
} from "@opencode/client"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { Router } from "@opencode/schema/router"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../ui/prompt"
import { createClient, loadIntegrations, location, request } from "./auth/shared"

export default Runtime.handler(Commands.commands.setup, (input) =>
  Effect.gen(function* () {
    yield* requireInteractive("System One and System Two setup requires an interactive terminal")
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const status = yield* request((signal) => client["server.intelligence"].status({ signal }))
    const models = (yield* request((signal) => client.model.list({ location }, { signal }))).data
      .filter(
        (model) =>
          model.enabled && model.capabilities.output.includes("text") && !IntelligenceEvaluation.isJev(model.id),
      )
      .toSorted((a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name))
    const providers = (yield* request((signal) => client.provider.list({ location }, { signal }))).data

    intro("Configure reasoning roles")
    const reasoning = yield* prompt<"single" | "dual">(() =>
      select({
        message: "Reasoning mode",
        initialValue: status.effective.reasoning,
        options: [
          { value: "single", label: "Single: S2 generates; S1 is off" },
          { value: "dual", label: "Dual: S2 generates; S1 evaluates" },
        ],
      }),
    )
    const principal = yield* chooseModel({
      client,
      models,
      providers,
      role: "S2 principal",
      current: status.settings.principal,
      recommended: status.router?.recommended?.default?.id,
      router: status.router?.providerID,
    })
    const evaluator = reasoning === "dual" ? yield* configureEvaluator(client, status) : undefined
    const available = (yield* request((signal) => client.model.list({ location }, { signal }))).data
    const currentFast = available.find(
      (model) =>
        model.enabled && model.providerID === status.settings.fast?.providerID && model.id === status.settings.fast?.id,
    )
    const fastChoice = yield* prompt<"reuse" | "keep" | "change">(() =>
      select({
        message: "S2 transformations: summaries and bounded text",
        initialValue: currentFast ? "keep" : "reuse",
        options: [
          { value: "reuse", label: `Reuse principal: ${principal.providerID}/${principal.id}` },
          ...(currentFast
            ? [{ value: "keep" as const, label: `Keep ${currentFast.name}`, hint: currentFast.providerID }]
            : []),
          { value: "change", label: "Choose another connection and model" },
        ],
      }),
    )
    const fast =
      fastChoice === "change"
        ? yield* chooseModel({
            client,
            models: available,
            principalProvider: principal.providerID,
            providers,
            role: "S2 transformations",
          })
        : fastChoice === "keep"
          ? currentFast
          : undefined
    const model = { providerID: principal.providerID, id: principal.id }
    log.info(`S2 principal: ${principal.name} (${principal.providerID}/${principal.id})`)
    log.info(`S2 transformations: ${fast ? `${fast.name} (${fast.providerID}/${fast.id})` : "reuse principal"}`)
    log.info(`S1 evaluator: ${evaluator ? `${evaluator.evaluator.transport}/${evaluator.evaluator.model}` : "off"}`)
    log.info("Checking the System Two connection...")
    yield* request((signal) =>
      client.generate.text(
        { prompt: "Reply with OK.", model, location, check: true },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
      ),
    ).pipe(
      Effect.tap((result) => Effect.sync(() => log.info(ConnectionCheck.describe(result.requests ?? [])))),
      Effect.tapError((error) =>
        Effect.sync(() => log.error(ConnectionCheck.describe(ConnectionCheck.requestsFrom(error)))),
      ),
    )
    if (fast && (fast.providerID !== principal.providerID || fast.id !== principal.id)) {
      log.info("Checking the System Two transformations connection...")
      yield* request((signal) =>
        client.generate.text(
          {
            prompt: "Reply with OK.",
            model: { providerID: fast.providerID, id: fast.id },
            location,
            check: true,
          },
          { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
        ),
      ).pipe(
        Effect.tap((result) => Effect.sync(() => log.info(ConnectionCheck.describe(result.requests ?? [])))),
        Effect.tapError((error) =>
          Effect.sync(() => log.error(ConnectionCheck.describe(ConnectionCheck.requestsFrom(error)))),
        ),
      )
    }
    if (evaluator) {
      log.info("Testing System One with a synthetic evaluation...")
      const check = yield* request((signal) =>
        client["server.intelligence"].probe(
          { evaluator: evaluator.evaluator, ...(evaluator.key ? { apiKey: evaluator.key } : {}) },
          { signal },
        ),
      )
      log.info(ConnectionCheck.describe(check.requests ?? []))
      if (!check.ok) return yield* Effect.fail(new Error(check.message))
    }
    const saved = yield* request((signal) =>
      client["server.intelligence"].save(
        {
          settings: {
            ...status.settings,
            enabled: true,
            reasoning,
            onboarding: "completed",
            principal: model,
            fast:
              fast && (fast.providerID !== principal.providerID || fast.id !== principal.id)
                ? { providerID: fast.providerID, id: fast.id }
                : undefined,
            ...(evaluator ? { evaluator: evaluator.evaluator } : {}),
          },
          ...(evaluator?.key ? { apiKey: evaluator.key } : {}),
        },
        { signal },
      ),
    )
    if (status.effective.source === "flag")
      log.info(`REDCODE_REASONING=${status.environment} overrides the saved reasoning mode for this server`)
    outro(
      saved.reasoning === "dual"
        ? "System Two and System One configured"
        : "System Two configured; System One remains optional",
    )
  }).pipe(handlePromptErrors),
)

const chooseModel = Effect.fn("cli.setup.model")(function* (input: {
  client: OpenCodeClient
  models: ModelInfo[]
  providers: ProviderInfo[]
  role: string
  principalProvider?: string
  current?: { providerID: string; id: string }
  recommended?: string
  router?: string
}) {
  const current = input.models.find(
    (model) => model.providerID === input.current?.providerID && model.id === input.current?.id,
  )
  const integrations = yield* loadIntegrations(input.client)
  const connections = integrations.flatMap((integration) => {
    const providers = input.providers.filter((provider) => (provider.integrationID ?? provider.id) === integration.id)
    const routes = providers.length
      ? providers.map((provider) => ({ id: provider.id, name: provider.name }))
      : ["red-router", "9router"].includes(integration.id)
        ? [{ id: integration.id, name: integration.name }]
        : []
    return routes.flatMap((route) =>
      integration.connections
        .filter((connection) => connection.type === "credential" || integration.connections[0]?.type === "env")
        .map((connection, index) => ({ ...route, connection, active: index === 0 })),
    )
  })
  const selectable = connections.filter((item) => item.id !== input.principalProvider || item.active)
  if (!selectable.length) return yield* Effect.fail(new Error("Connect a generative service before setup"))
  const index = Number(
    yield* prompt<string>(() =>
      autocomplete({
        message: `${input.role} · connection`,
        maxItems: 10,
        initialValue: String(
          Math.max(
            0,
            selectable.findIndex((item) => item.id === (current?.providerID ?? input.router) && item.active),
          ),
        ),
        options: selectable.map((item, index) => ({
          value: String(index),
          label: item.connection.type === "credential" ? item.connection.label : item.connection.name,
          hint: `${item.name}${item.active ? " · active" : " · activates account"}`,
        })),
      }),
    ),
  )
  const connection = selectable[index]
  const provider = connection.id
  if (!connection.active && connection.connection.type === "credential") {
    const credentialID = connection.connection.id
    yield* request((signal) => input.client.credential.activate({ credentialID }, { signal }))
  }
  const deadline = Date.now() + 30_000
  const load = (): Effect.Effect<ModelInfo[], unknown> =>
    request((signal) => input.client.model.list({ location }, { signal })).pipe(
      Effect.map((response) =>
        response.data.filter(
          (model) =>
            model.providerID === provider &&
            model.enabled &&
            model.capabilities.output.includes("text") &&
            !IntelligenceEvaluation.isJev(model.id),
        ),
      ),
      Effect.flatMap((models) =>
        models.length || Date.now() >= deadline
          ? Effect.succeed(models)
          : Effect.sleep("250 millis").pipe(Effect.andThen(load)),
      ),
    )
  const models = yield* load()
  if (!models.length)
    return yield* Effect.fail(
      new Error("This connection has no S2 models. Check its catalog or choose another connection."),
    )
  const selected = yield* prompt<string>(() =>
    autocomplete({
      message: `${input.role} · model · ${input.providers.find((item) => item.id === provider)?.name ?? provider}`,
      maxItems: 10,
      initialValue:
        current?.providerID === provider ? current.id : input.router === provider ? input.recommended : undefined,
      options: models
        .toSorted(
          (a, b) =>
            Number(b.id === input.recommended && b.providerID === input.router) -
              Number(a.id === input.recommended && a.providerID === input.router) || a.name.localeCompare(b.name),
        )
        .map((model) => ({
          value: model.id,
          label: model.name,
          hint:
            model.id === input.recommended && model.providerID === input.router
              ? `Recommended · ${model.id}`
              : provider === "red-router" || provider === "9router"
                ? `${Router.route(model.id).provider ?? "router"} · ${model.id}`
                : model.id,
        })),
    }),
  )
  const model = models.find((model) => model.id === selected)
  if (!model) return yield* Effect.fail(new Error(`Model unavailable: ${provider}/${selected}`))
  return model
})

const configureEvaluator: (
  client: OpenCodeClient,
  status: IntelligenceStatus,
  retry?: number,
) => Effect.Effect<{ evaluator: IntelligenceEvaluator; key: undefined }, unknown> = Effect.fn("cli.setup.evaluator")(
  function* (client: OpenCodeClient, status: IntelligenceStatus, retry?: number) {
    const options = status.evaluators
    if (!options.length)
      return yield* Effect.fail(
        new Error("No S1 connection available. Run `redcode auth login` to connect a service that supports decisions."),
      )
    const index =
      retry ??
      Number(
        yield* prompt<string>(() =>
          autocomplete({
            message: "S1 evaluator · connection",
            maxItems: 10,
            initialValue: String(options.findIndex((option) => option.configured)),
            options: options.map((option, index) => ({
              value: String(index),
              label: option.name,
              hint: `${option.evaluator.transport} · ${option.evaluator.baseURL}`,
            })),
          }),
        ),
      )
    const evaluator: IntelligenceEvaluator = options[index].evaluator
    const discovered = yield* request((signal) =>
      client["server.intelligence"].discover(
        { evaluator },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
      ),
    ).pipe(
      Effect.catch((error) => {
        log.warn(error instanceof Error ? error.message : "S1 model discovery failed")
        return Effect.succeed(undefined)
      }),
    )
    if (!discovered?.models.length) {
      const action = yield* prompt<"retry" | "connection">(() =>
        select({
          message: discovered ? "No S1 models available" : "S1 catalog unavailable",
          options: [
            { value: "retry", label: "Refresh model list" },
            { value: "connection", label: "Choose another connection" },
          ],
        }),
      )
      return yield* configureEvaluator(client, status, action === "retry" ? index : undefined)
    }
    const model = yield* prompt<string>(() =>
      autocomplete({
        message: `S1 evaluator · model · ${options[index].name}`,
        maxItems: 10,
        initialValue: evaluator.model,
        options: discovered.models
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({ value: item.id, label: item.name, hint: item.id })),
      }),
    )
    log.info("Sources and candidates will be sent to the selected System One evaluator")
    return { evaluator: { ...evaluator, model }, key: undefined }
  },
)

import { autocomplete, intro, log, outro, select, text } from "@clack/prompts"
import {
  type IntelligenceEvaluator,
  type IntelligenceStatus,
  type ModelInfo,
  type OpenCodeClient,
  type ProviderInfo,
} from "@opencode/client"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { Router } from "@opencode/schema/router"
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
    if (models.length === 0) return yield* Effect.fail(new Error("Connect a generative provider before setup"))

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
    const currentFast = models.find(
      (model) => model.providerID === status.settings.fast?.providerID && model.id === status.settings.fast?.id,
    )
    const choice = yield* chooseModel({
      models,
      providers,
      role: "S2 principal: generates responses and does the work",
      current: status.settings.principal,
      keepRoles: status.settings.onboarding === "completed",
      currentFast,
      recommended: status.router?.recommended?.default?.id,
      router: status.router?.providerID,
    })
    const principal =
      choice === "keep-roles"
        ? models.find(
            (model) =>
              model.providerID === status.settings.principal?.providerID && model.id === status.settings.principal.id,
          )
        : choice
    if (!principal) return yield* Effect.fail(new Error("Current System Two model is unavailable"))
    const fastChoice =
      choice === "keep-roles"
        ? currentFast
          ? "keep"
          : "reuse"
        : yield* prompt<"reuse" | "keep" | "change">(() =>
            select({
              message: "S2 transformations: summaries and bounded text",
              initialValue: currentFast ? "keep" : "reuse",
              options: [
                { value: "reuse", label: `Reuse principal: ${principal.providerID}/${principal.id}` },
                ...(currentFast
                  ? [{ value: "keep" as const, label: `Keep ${currentFast.name}`, hint: currentFast.providerID }]
                  : []),
                { value: "change", label: "Choose another provider and model" },
              ],
            }),
          )
    const fast =
      fastChoice === "change"
        ? yield* chooseModel({ models, providers, role: "S2 transformations: summaries and bounded text" })
        : fastChoice === "keep"
          ? currentFast
          : undefined
    if (fast === "keep-roles") return yield* Effect.fail(new Error("Unexpected System Two selection"))
    const evaluator = reasoning === "dual" ? yield* configureEvaluator(client, status) : undefined
    const model = { providerID: principal.providerID, id: principal.id }
    log.info(`S2 principal: ${principal.name} (${principal.providerID}/${principal.id})`)
    log.info(`S2 transformations: ${fast ? `${fast.name} (${fast.providerID}/${fast.id})` : "reuse principal"}`)
    log.info(`S1 evaluator: ${evaluator ? `${evaluator.evaluator.transport}/${evaluator.evaluator.model}` : "off"}`)
    log.info("Checking the System Two connection...")
    yield* request((signal) =>
      client.generate.text(
        { prompt: "Reply with OK.", model, location },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
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
          },
          { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
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
  models: ModelInfo[]
  providers: ProviderInfo[]
  role: string
  current?: { providerID: string; id: string }
  keepRoles?: boolean
  currentFast?: ModelInfo
  recommended?: string
  router?: string
}) {
  const current = input.models.find(
    (model) => model.providerID === input.current?.providerID && model.id === input.current?.id,
  )
  const groups = Object.groupBy(input.models, (model) => model.providerID)
  const provider = yield* prompt<string>(() =>
    autocomplete({
      message: `${input.role} · provider`,
      maxItems: 10,
      initialValue: current ? (input.keepRoles ? "keep-roles" : "keep") : input.router,
      options: [
        ...(current && input.keepRoles
          ? [
              {
                value: "keep-roles",
                label: "Continue with current S2 setup",
                hint: `${current.providerID}/${current.id} · transformations: ${input.currentFast ? `${input.currentFast.providerID}/${input.currentFast.id}` : "reuse principal"}`,
              },
            ]
          : []),
        ...(current
          ? [{ value: "keep", label: `Keep ${current.name}`, hint: `${current.providerID}/${current.id}` }]
          : []),
        ...Object.entries(groups)
          .toSorted(
            ([left], [right]) =>
              Number(right === "red-router") - Number(left === "red-router") ||
              Number(right === "9router") - Number(left === "9router") ||
              left.localeCompare(right),
          )
          .map(([id, models]) => ({
            value: id,
            label: input.providers.find((item) => item.id === id)?.name ?? id,
            hint: `${models?.length ?? 0} models${id === input.router && input.recommended ? " · recommendation available" : ""}`,
          })),
      ],
    }),
  )
  if (provider === "keep-roles") return "keep-roles" as const
  if (provider === "keep" && current) return current
  const models = groups[provider] ?? []
  const selected = yield* prompt<string>(() =>
    autocomplete({
      message: `${input.role} · ${input.providers.find((item) => item.id === provider)?.name ?? provider}`,
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

const configureEvaluator = Effect.fn("cli.setup.evaluator")(function* (
  client: OpenCodeClient,
  status: IntelligenceStatus,
) {
  const current = status.settings.evaluator
  const action = current
    ? yield* prompt<"continue" | "change">(() =>
        select({
          message: "System One evaluator",
          options: [
            { value: "continue", label: `Keep ${current.transport}/${current.model}` },
            { value: "change", label: "Choose another evaluator" },
          ],
        }),
      )
    : "change"
  if (action === "continue" && current) return { evaluator: current, key: undefined }

  // System One only offers services that already have an active connection; nothing is asked for inline, and the
  // connection's own credential does the evaluating.
  const connected = new Set(
    (yield* loadIntegrations(client))
      .filter((integration) => integration.connections.length > 0)
      .map((item) => item.id),
  )
  const options = [
    ...(status.router?.evaluator ? [{ name: "Detected RedRouter", evaluator: status.router.evaluator }] : []),
    ...status.evaluators.filter(
      (option) =>
        connected.has(option.evaluator.transport) &&
        (option.evaluator.transport !== "red-router" || !status.router?.evaluator),
    ),
  ]
  if (options.length === 0)
    return yield* Effect.fail(
      new Error(
        "No connected service can evaluate. Run `redcode auth login` to connect one, then run the setup again.",
      ),
    )
  const index = Number(
    yield* prompt<string>(() =>
      autocomplete({
        message: "System One connection",
        maxItems: 10,
        options: options.map((option, index) => ({
          value: String(index),
          label: option.name,
          hint: `${option.evaluator.transport}/${option.evaluator.model}`,
        })),
      }),
    ),
  )
  const evaluator: IntelligenceEvaluator | undefined = options[index]?.evaluator
  if (!evaluator) return yield* Effect.fail(new Error("System One connection is unavailable"))
  const discovered = yield* request((signal) => client["server.intelligence"].discover({ evaluator }, { signal }))
  const model = discovered.models.length
    ? yield* prompt<string>(() =>
        autocomplete({
          message: "System One model",
          maxItems: 10,
          options: [
            { value: evaluator.model, label: evaluator.model },
            ...discovered.models
              .filter((item) => item.id !== evaluator.model)
              .map((item) => ({ value: item.id, label: item.name })),
          ],
        }),
      )
    : yield* prompt<string>(() => text({ message: "System One model", initialValue: evaluator.model }))
  log.info("Sources and candidates will be sent to the selected System One evaluator")
  return { evaluator: { ...evaluator, model }, key: undefined }
})

import { autocomplete, intro, log, outro, password, select, text } from "@clack/prompts"
import { type IntelligenceEvaluator, type IntelligenceStatus, type OpenCodeClient } from "@opencode/client"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../ui/prompt"
import { createClient, location, request } from "./auth/shared"

export default Runtime.handler(Commands.commands.setup, (input) =>
  Effect.gen(function* () {
    yield* requireInteractive("System One and System Two setup requires an interactive terminal")
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const status = yield* request((signal) => client["server.intelligence"].status({ signal }))
    const models = (yield* request((signal) => client.model.list({ location }, { signal }))).data
      .filter((model) => model.enabled && model.capabilities.output.includes("text") && !IntelligenceEvaluation.isJev(model.id))
      .toSorted((a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name))
    if (models.length === 0) return yield* Effect.fail(new Error("Connect a generative provider before setup"))

    intro("Configure reasoning roles")
    const reasoning = yield* prompt<"single" | "dual">(() =>
      select({
        message: "Reasoning mode",
        initialValue: status.effective.reasoning,
        options: [
          { value: "single", label: "Single: System Two only" },
          { value: "dual", label: "Dual: System Two with System One evaluation" },
        ],
      }),
    )
    const current = status.settings.principal
      ? `${status.settings.principal.providerID}/${status.settings.principal.id}`
      : undefined
    const recommended = status.router?.recommended?.default
    const suggested = recommended
      ? models.find((model) => model.providerID === status.router?.providerID && model.id === recommended.id)
      : undefined
    const principal = yield* prompt<string>(() =>
      autocomplete({
        message: "System Two model",
        maxItems: 10,
        initialValue: current ?? (suggested ? `${suggested.providerID}/${suggested.id}` : undefined),
        options: [
          ...(suggested
            ? [{
                value: `${suggested.providerID}/${suggested.id}`,
                label: `Recommended: ${suggested.name}`,
                hint: recommended?.reason,
              }]
            : []),
          ...models
            .filter((model) => model !== suggested)
            .map((model) => ({
              value: `${model.providerID}/${model.id}`,
              label: `${model.providerID}: ${model.name}`,
              hint: `${model.providerID}/${model.id}` === current ? "current" : model.id,
            })),
        ],
      }),
    )
    const evaluator = reasoning === "dual" ? yield* configureEvaluator(client, status) : undefined
    const separator = principal.indexOf("/")
    const model = { providerID: principal.slice(0, separator), id: principal.slice(separator + 1) }
    log.info("Checking the System Two connection...")
    yield* request((signal) =>
      client.generate.text(
        { prompt: "Reply with OK.", model, location },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
      ),
    )
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

  const options = [
    ...(status.router?.evaluator
      ? [{ name: "Detected RedRouter", evaluator: status.router.evaluator }]
      : []),
    ...status.evaluators,
  ]
  const index = Number(yield* prompt<string>(() =>
    autocomplete({
      message: "System One connection",
      maxItems: 10,
      options: options.map((option, index) => ({
        value: String(index),
        label: option.name,
        hint: `${option.evaluator.transport}/${option.evaluator.model}`,
      })),
    }),
  ))
  const chosen = options[index]
  if (!chosen) return yield* Effect.fail(new Error("System One connection is unavailable"))
  const baseURL = yield* prompt<string>(() =>
    text({
      message: "System One API base URL",
      initialValue: chosen.evaluator.baseURL,
    }),
  )
  const key = yield* prompt<string>(() =>
    password({ message: "API key (leave empty to reuse saved credentials or the provider connection)" }),
  )
  const evaluator: IntelligenceEvaluator = {
    ...chosen.evaluator,
    baseURL,
    credentialID: chosen.evaluator.baseURL === baseURL ? chosen.evaluator.credentialID : undefined,
  }
  const discovered = yield* request((signal) =>
    client["server.intelligence"].discover({ evaluator, ...(key ? { apiKey: key } : {}) }, { signal }),
  )
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
  return { evaluator: { ...evaluator, model }, key: key || undefined }
})

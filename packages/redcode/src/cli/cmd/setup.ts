import type { Evaluator } from "@reddb-io/redcode-schema/intelligence"
import { Effect, Option } from "effect"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { Location } from "@reddb-io/redcode-core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@reddb-io/redcode-core/location-services"
import { Semantic } from "@reddb-io/redcode-core/semantic"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { Model } from "@reddb-io/redcode-schema/model"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { intro, outro, text, password, select } from "../effect/prompt"

const answer = <A>(value: Option.Option<A>) =>
  Option.isSome(value) ? Effect.succeed(value.value) : fail("Setup cancelled; previous configuration preserved")
export const SetupCommand = effectCmd({
  command: "setup",
  describe: "configure global System One and System Two roles",
  instance: false,
  handler: Effect.fn("Cli.setup")(
    function* () {
      const service = yield* Intelligence.Service
      const previous = yield* service.read()
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        return yield* fail(
          "Interactive setup requires a terminal. Configure S1 and S2 with the global intelligence API.",
        )
      const { Provider } = yield* Effect.promise(() => import("../../provider/provider"))
      const provider = yield* Provider.Service
      const semantic = yield* Semantic.Service.pipe(
        Effect.provide(
          LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })),
        ),
        Effect.provide(locationServiceMapLayer),
      )
      const providers = yield* provider.list()
      const evaluators = yield* service.options()
      const choices = Object.values(providers).flatMap((provider) =>
        Object.values(provider.models)
          .filter((model) => model.capabilities.protocol !== "systemone")
          .map((model) => ({
            value: `${provider.id}/${model.id}`,
            label: `${provider.name}: ${model.name}`,
          })),
      )
      if (!choices.length)
        return yield* fail("Connect a generative provider with redcode providers before running setup")
      yield* intro(`Global intelligence setup — ${service.environment}`)
      const principal = yield* answer(yield* select<string>({ message: "System Two — principal", options: choices }))
      const fast = yield* answer(
        yield* select<string>({
          message: "System Two — transformations",
          options: [
            { value: principal, label: "Reuse principal" },
            ...choices.filter((choice) => choice.value !== principal),
          ],
        }),
      )
      const transport = yield* answer(
        yield* select<Evaluator["transport"]>({
          message: "System One connection",
          options: evaluators.map((option) => ({
            value: option.evaluator.transport,
            label: `${option.configured ? "Configured · " : ""}${option.name}`,
          })),
        }),
      )
      const selected = evaluators.find((option) => option.evaluator.transport === transport)!
      const baseURL = yield* answer(
        yield* text({
          message: "API base URL",
          initialValue:
            previous.evaluator?.transport === transport ? previous.evaluator.baseURL : selected.evaluator.baseURL,
        }),
      )
      const key = yield* answer(
        yield* password({
          message: selected.configured
            ? "API key (empty reuses the configured provider connection)"
            : transport === "opencode-zen"
              ? "Zen API key (empty reuses OpenCode connection, OPENCODE_API_KEY, or public free access)"
              : "System One API key (leave empty to reuse saved credentials or environment)",
        }),
      )
      const credentialID =
        previous.evaluator?.transport === transport && previous.evaluator.baseURL === baseURL
          ? previous.evaluator.credentialID
          : selected.evaluator.baseURL === baseURL
            ? selected.evaluator.credentialID
            : undefined
      const evaluator = {
        transport,
        baseURL,
        model: previous.evaluator?.transport === transport ? previous.evaluator.model : selected.evaluator.model,
        ...(credentialID ? { credentialID } : {}),
      }
      const discovered = yield* service.discover({ evaluator, ...(key ? { apiKey: key } : {}) })
      const model = discovered.models.length
        ? yield* answer(
            yield* select<string>({
              message: "System One — evaluator",
              options: [
                { value: evaluator.model, label: evaluator.model },
                ...discovered.models
                  .filter((model) => model.id !== evaluator.model)
                  .map((model) => ({ value: model.id, label: model.name })),
              ],
            }),
          )
        : yield* answer(yield* text({ message: "System One model", initialValue: evaluator.model }))
      if (transport === "opencode-zen")
        yield* outro(
          "Jev Free is a temporary offer. If unavailable, choose another evaluator; setup never switches to a paid model automatically.",
        )
      yield* outro("Sources and candidates will be sent to the selected evaluator. Testing with a synthetic example.")
      const ref = (value: string) => ({
        providerID: ProviderV2.ID.make(value.slice(0, value.indexOf("/"))),
        id: Model.ID.make(value.slice(value.indexOf("/") + 1)),
      })
      for (const selected of [...new Set([principal, fast])]) {
        const checked = yield* semantic.probeModel(ref(selected))
        if (!checked.ok) return yield* fail(checked.message)
      }
      const check = yield* service.probe({ evaluator: { ...evaluator, model }, ...(key ? { apiKey: key } : {}) })
      if (!check.ok) return yield* fail(check.message)
      yield* service.save({
        settings: {
          enabled: true,
          onboarding: "completed",
          principal: ref(principal),
          ...(fast === principal ? {} : { fast: ref(fast) }),
          evaluator: { ...evaluator, model },
        },
        ...(key ? { apiKey: key } : {}),
      })
      yield* outro("Global intelligence configured. Projects on this server share these roles.")
    },
    Effect.mapError((error) => new CliError({ message: error.message })),
  ),
})

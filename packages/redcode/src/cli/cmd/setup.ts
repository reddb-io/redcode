import type { DetectedRouter, Reasoning, Settings } from "@reddb-io/redcode-schema/intelligence"
import { Router } from "@reddb-io/redcode-schema/router"
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
  instance: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
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
      // A connected RedRouter's recommendations come first in each model list; it also serves S1.
      const router = yield* service.router()
      yield* intro(`Global intelligence setup — ${service.environment}`)
      const effective = Intelligence.reasoning(previous)
      const reasoning = yield* answer(
        yield* select<Reasoning>({
          message:
            effective.source === "flag"
              ? `Reasoning mode (this run uses --reasoning ${effective.reasoning})`
              : "Reasoning mode",
          initialValue: effective.reasoning,
          options: [
            {
              value: "single",
              label: "Simple — one model",
              hint: "S2 only; completion checks report S1 as not verified",
            },
            { value: "dual", label: "Dual — S1 classifies and validates, S2 executes" },
          ],
        }),
      )
      const label = (value: string) => choices.find((choice) => choice.value === value)?.label ?? value
      const saved = previous.principal ? `${previous.principal.providerID}/${previous.principal.id}` : undefined
      const continued = saved
        ? (yield* answer(
            yield* select<"continue" | "change">({
              message: "S2 (System Two)",
              options: [
                { value: "continue", label: `Continue with ${label(saved)}` },
                { value: "change", label: "Change System Two model…" },
              ],
            }),
          )) === "continue"
        : false
      const principalChoices = recommendedFirst(choices, router, "default")
      const principal =
        continued && saved
          ? saved
          : yield* answer(
              yield* select<string>({
                message: "S2 (System Two) — principal",
                options: principalChoices.options,
                initialValue: principalChoices.initialValue ?? saved,
              }),
            )
      const systemOne = reasoning === "dual" ? yield* configureSystemOne(service, previous, router) : undefined
      const ref = (value: string) => ({
        providerID: ProviderV2.ID.make(value.slice(0, value.indexOf("/"))),
        id: Model.ID.make(value.slice(value.indexOf("/") + 1)),
      })
      const checked = yield* semantic.probeModel(ref(principal))
      if (!checked.ok) return yield* fail(checked.message)
      const apiKey = systemOne?.key ? { apiKey: systemOne.key } : {}
      if (systemOne) {
        const check = yield* service.probe({ evaluator: systemOne.evaluator, ...apiKey })
        if (!check.ok) return yield* fail(check.message)
      }
      yield* service.save({
        settings: {
          enabled: true,
          reasoning,
          onboarding: "completed",
          principal: ref(principal),
          // Single reasoning keeps the saved S1 evaluator (runtime ignores it) so dual can continue with it.
          evaluator: systemOne?.evaluator ?? previous.evaluator,
        },
        ...apiKey,
      })
      yield* outro(
        systemOne
          ? "Global intelligence configured. Projects on this server share these roles."
          : "Single reasoning configured: S2 only. Projects on this server share this model.",
      )
    },
    Effect.mapError((error) => new CliError({ message: error.message })),
  ),
})

/**
 * Moves the model a connected RedRouter recommends for a role to the top of a model list, labelled
 * with where it comes from and why, and preselects it. The list is unchanged when there is no
 * recommendation or the router does not list the recommended model.
 */
export function recommendedFirst(
  choices: ReadonlyArray<{ value: string; label: string; hint?: string }>,
  router: DetectedRouter | undefined,
  role: "default",
) {
  const pick = router?.recommended?.[role]
  const listed = pick && choices.find((choice) => choice.value === `${router?.providerID}/${pick.id}`)
  if (!pick || !listed) return { options: [...choices], initialValue: undefined }
  return {
    options: [
      {
        value: listed.value,
        label: `Recommended: ${pick.name} · via RedRouter${pick.provider.name ? `${Router.HOP_SEPARATOR}${pick.provider.name}` : ""}`,
        hint: pick.reason,
      },
      ...choices.filter((choice) => choice !== listed),
    ],
    initialValue: listed.value,
  }
}

/** Dual reasoning only: keep the saved S1 evaluator or choose, discover and confirm another one. */
function configureSystemOne(service: Intelligence.Interface, previous: Settings, router: DetectedRouter | undefined) {
  return Effect.gen(function* () {
    const current = previous.evaluator
    if (
      current &&
      (yield* answer(
        yield* select<"continue" | "change">({
          message: "S1 (System One)",
          options: [
            { value: "continue", label: `Continue with ${current.transport}/${current.model}` },
            { value: "change", label: "Change System One connection…" },
          ],
        }),
      )) === "continue"
    )
      return { evaluator: current, key: "" }
    const evaluators = yield* service.options()
    // A connected RedRouter that serves System One comes first: it shares the provider's key.
    const detected = router?.evaluator
    const choice = yield* answer(
      yield* select<string>({
        message: "S1 (System One) connection",
        options: [
          ...(router && detected
            ? [
                {
                  value: "detected" as const,
                  label: `Use RedRouter ${router.detection.instanceID ?? URL.parse(router.baseURL)?.host ?? router.baseURL} (detected)`,
                  hint: [
                    detected.model,
                    ...(router.recommended?.systemone?.id === detected.model ? ["recommended"] : []),
                    "shares the provider connection",
                  ].join(" · "),
                },
              ]
            : []),
          // A connected RedRouter lists one option per System One model it serves.
          ...evaluators.map((option, index) => ({
            value: String(index),
            label: `${option.configured ? "Configured · " : ""}${option.name}`,
          })),
        ],
      }),
    )
    if (choice === "detected")
      return detected ? { evaluator: detected, key: "" } : yield* fail("No RedRouter with System One was detected")
    const selected = evaluators[Number(choice)]
    if (!selected) return yield* fail(`Unknown S1 connection: ${choice}`)
    // A model the connected RedRouter listed already carries the router's address and credential.
    if (
      selected.configured &&
      selected.evaluator.transport === "red-router" &&
      /^RedRouter [·»] /.test(selected.name)
    )
      return { evaluator: selected.evaluator, key: "" }
    const transport = selected.evaluator.transport
    const baseURL = yield* answer(
      yield* text({
        message: "API base URL",
        initialValue: current?.transport === transport ? current.baseURL : selected.evaluator.baseURL,
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
      current?.transport === transport && current.baseURL === baseURL
        ? current.credentialID
        : selected.evaluator.baseURL === baseURL
          ? selected.evaluator.credentialID
          : undefined
    const evaluator = {
      transport,
      baseURL,
      model: current?.transport === transport ? current.model : selected.evaluator.model,
      ...(credentialID ? { credentialID } : {}),
    }
    const discovered = yield* service.discover({ evaluator, ...(key ? { apiKey: key } : {}) })
    const model = discovered.models.length
      ? yield* answer(
          yield* select<string>({
            message: "S1 (System One) — evaluator",
            options: [
              { value: evaluator.model, label: evaluator.model },
              ...discovered.models
                .filter((model) => model.id !== evaluator.model)
                .map((model) => ({ value: model.id, label: model.name })),
            ],
          }),
        )
      : yield* answer(yield* text({ message: "S1 (System One) model", initialValue: evaluator.model }))
    if (transport === "opencode-zen")
      yield* outro(
        "Jev Free is a temporary offer. If unavailable, choose another evaluator; setup never switches to a paid model automatically.",
      )
    yield* outro("Sources and candidates will be sent to the selected evaluator. Testing with a synthetic example.")
    return { evaluator: { ...evaluator, model }, key }
  })
}

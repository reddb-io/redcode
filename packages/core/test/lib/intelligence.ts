import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { Effect, Layer } from "effect"

/** Provider and tool fixtures configure both roles without adding unrelated evaluator traffic. */
export const configuredIntelligence = Layer.mock(Intelligence.Service, {
  environment: "test",
  read: () =>
    Effect.succeed({
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("fixture") },
      evaluator: { transport: "typesafe", baseURL: "https://system-one.test/v1", model: "jev-test" },
    }),
  history: () => Effect.succeed([]),
  evaluate: () => Effect.succeed(undefined),
  generation: () => Effect.void,
})

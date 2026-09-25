// A RedRouter `/v1/models?id_format=flat` list, after red-router#128's sample: OpenRouter and
// Anthropic connected, plus JEV 1.13 served through two remote RedRouter hops and OpenRouter.
const PARAMETERS = { context_length: 200000, max_completion_tokens: 64000, thinking_levels: ["low", "high"] }
const OPENCODE_GO = { context_length: 128000, max_completion_tokens: 16000, thinking_levels: ["low"] }

export const FLAT_LIST = {
  object: "list",
  id_format: "flat",
  data: [
    {
      id: "anthropic/claude-sonnet-4-5",
      object: "model",
      owned_by: "combo",
      flat: true,
      name: "Claude Sonnet 4.5",
      provider: { id: "combo", slug: "combo", name: "Combo", category: "combo" },
      strategy: "fallback",
      canonical: "anthropic/claude-sonnet-4-5",
      members: ["anthropic/claude-sonnet-4-5", "openrouter/anthropic/claude-sonnet-4.5"],
      offers: [
        {
          id: "anthropic/claude-sonnet-4-5",
          pin_id: null,
          provider: { id: "anthropic", slug: "anthropic", name: "Anthropic", category: "apikey", subscription: false },
          via: [],
          available: true,
          price: { input: 3, output: 15 },
          free: false,
        },
        {
          id: "openrouter/anthropic/claude-sonnet-4.5",
          pin_id: "openrouter/anthropic/claude-sonnet-4.5",
          provider: {
            id: "openrouter",
            slug: "openrouter",
            name: "OpenRouter",
            category: "freeTier",
            subscription: false,
          },
          via: [],
          available: true,
          price: { input: 3, output: 15 },
          free: false,
        },
      ],
      context_length: 200000,
      max_completion_tokens: 64000,
      parameters: PARAMETERS,
      parameters_basis: "lead",
      parameters_strict: PARAMETERS,
      member_parameters: [
        { id: "anthropic/claude-sonnet-4-5", parameters: PARAMETERS },
        { id: "openrouter/anthropic/claude-sonnet-4.5", parameters: PARAMETERS },
      ],
      thinking_levels: ["low", "high"],
    },
    {
      id: "typesafe/jev-1.13",
      object: "model",
      owned_by: "combo",
      flat: true,
      name: "JEV 1.13",
      provider: { id: "combo", slug: "combo", name: "Combo", category: "combo" },
      strategy: "fallback",
      canonical: "typesafe/jev-latest",
      members: ["red-router/red-router/opencode-go/typesafe/jev-1.13", "openrouter/typesafe/jev-1.13"],
      offers: [
        {
          id: "red-router/red-router/opencode-go/typesafe/jev-1.13",
          pin_id: "red-router/red-router/opencode-go/typesafe/jev-1.13",
          provider: { id: "opencode-go", slug: "opencode-go", name: "OpenCode Go", category: "apikey" },
          via: [
            { slug: "red-router", name: "RedRouter" },
            { slug: "red-router", name: "Office RedRouter" },
          ],
          available: true,
          price: { input: 0.042, output: 0 },
          free: false,
        },
        {
          id: "openrouter/typesafe/jev-1.13",
          pin_id: "openrouter/typesafe/jev-1.13",
          provider: { id: "openrouter", slug: "openrouter", name: "OpenRouter", category: "freeTier" },
          via: [],
          available: true,
          price: { input: 0.05, output: 0 },
          free: false,
        },
      ],
      parameters: OPENCODE_GO,
      parameters_basis: "lead",
      member_parameters: [
        { id: "red-router/red-router/opencode-go/typesafe/jev-1.13", parameters: OPENCODE_GO },
        { id: "openrouter/typesafe/jev-1.13", parameters: PARAMETERS },
      ],
    },
  ],
}

import { expect, test } from "bun:test"
import type { ProviderListResponse } from "@reddb-io/redcode-sdk/v2"
import { providerCatalog } from "../../src/context/sync"

test("keeps provider ids, names and env, and drops the models the TUI never reads", () => {
  const list = {
    all: [
      { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"], models: { "claude-x": { id: "claude-x" } } },
      { id: "openai", name: "OpenAI", env: [], models: {} },
    ],
    default: { anthropic: "claude-x" },
    connected: ["anthropic"],
  } as unknown as ProviderListResponse

  expect(providerCatalog(list)).toEqual({
    all: [
      { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"] },
      { id: "openai", name: "OpenAI", env: [] },
    ],
    default: { anthropic: "claude-x" },
    connected: ["anthropic"],
  })
})

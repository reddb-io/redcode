import { expect, test } from "bun:test"
import type { ModelRef } from "@opencode/client/promise"
import { NO_PROVIDER_MESSAGE, selectRunModel } from "../../src/run/run"

const location = { directory: "/work" }

function catalog(data: ModelRef | null) {
  const requests: string[] = []
  return {
    requests,
    client: {
      model: {
        default: (input: { location: { directory: string } }) => {
          requests.push(input.location.directory)
          return Promise.resolve({ data })
        },
      },
    },
  }
}

test("a run with no connected provider stops with how to connect one", async () => {
  const empty = catalog(null)
  await expect(selectRunModel(empty.client, { location, model: undefined }, undefined)).rejects.toThrow(
    NO_PROVIDER_MESSAGE,
  )
  expect(empty.requests).toEqual(["/work"])
  expect(NO_PROVIDER_MESSAGE).toContain("/connect")
  expect(NO_PROVIDER_MESSAGE).not.toContain("OpenCode")
})

test("a run with a default leaves the model to the Session's agent", async () => {
  const connected = catalog({ providerID: "anthropic", id: "claude" })
  expect(await selectRunModel(connected.client, { location, model: undefined }, undefined)).toBeUndefined()
})

test("a variant pins the default model it applies to", async () => {
  const connected = catalog({ providerID: "anthropic", id: "claude" })
  expect(await selectRunModel(connected.client, { location, model: undefined }, "high")).toEqual({
    providerID: "anthropic",
    id: "claude",
    variant: "high",
  })
})

test("a requested model skips the default lookup", async () => {
  const empty = catalog(null)
  expect(
    await selectRunModel(
      empty.client,
      { location, model: { providerID: "openai", id: "gpt", variant: "low" } },
      undefined,
    ),
  ).toEqual({ providerID: "openai", id: "gpt", variant: "low" })
  expect(empty.requests).toEqual([])
})

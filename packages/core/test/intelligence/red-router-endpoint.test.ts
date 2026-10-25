import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { redRouterEndpoint } from "@opencode/core/intelligence/red-router-endpoint"
import { Integration } from "@opencode/schema/integration"
import { Effect } from "effect"
import { withEnv } from "../fixture/env"

describe("RedRouter endpoint", () => {
  test("does not redirect an unconfigured or legacy connection through the environment", () =>
    Effect.runSync(
      withEnv({ RED_ROUTER_BASE_URL: "https://environment.example/v1" }, () =>
        Effect.sync(() => {
          const credential = new Credential.Info({
            id: Credential.ID.create(),
            integrationID: Integration.ID.make("red-router"),
            label: "Legacy RedRouter",
            value: Credential.Key.make({ type: "key", key: "selected" }),
          })
          expect(redRouterEndpoint()).toBe("http://127.0.0.1:25050/v1")
          expect(redRouterEndpoint(credential)).toBe("http://127.0.0.1:25050/v1")
        }),
      ),
    ))

  test("uses the endpoint saved by the provider connection form for S1 and S2", () =>
    Effect.runSync(
      withEnv({ RED_ROUTER_BASE_URL: "https://environment.example/v1" }, () =>
        Effect.sync(() => {
          const credential = new Credential.Info({
            id: Credential.ID.create(),
            integrationID: Integration.ID.make("red-router"),
            label: "RedRouter",
            value: Credential.Key.make({
              type: "key",
              key: "secret",
              configuration: { baseURL: "https://selected.example/v1/models" },
              metadata: { baseURL: "https://old.example/v1" },
            }),
          })
          expect(redRouterEndpoint(credential)).toBe("https://selected.example/v1")
        }),
      ),
    ))

  test("rejects an invalid saved endpoint rather than redirecting its key to a fallback", () => {
    const credential = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "RedRouter",
      value: Credential.Key.make({
        type: "key",
        key: "secret",
        configuration: { baseURL: "https://other@example.com/v1" },
      }),
    })
    expect(redRouterEndpoint(credential)).toBeUndefined()
  })
})

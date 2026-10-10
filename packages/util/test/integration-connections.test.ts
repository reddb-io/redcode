import { describe, expect, test } from "bun:test"
import { IntegrationConnections } from "../src/integration-connections.js"

describe("connectMethods", () => {
  test("offers key and OAuth methods but not environment discovery", () => {
    expect(
      IntegrationConnections.connectMethods({
        methods: [
          { type: "env", names: ["EXAMPLE_KEY"] },
          { type: "key", label: "API key" },
          { type: "oauth", id: "account", label: "Account" },
        ],
      }).map((method) => method.type),
    ).toEqual(["oauth", "key"])
  })
})

describe("credentialConnections", () => {
  test("returns removable credential connections only", () => {
    expect(
      IntegrationConnections.credentialConnections({
        connections: [
          { type: "env" as const, name: "EXAMPLE_KEY" },
          { type: "credential" as const, method: "key", id: "cred_1", label: "Work" },
        ],
      }),
    ).toEqual([{ type: "credential", method: "key", id: "cred_1", label: "Work" }])
  })
})

describe("connectionSummary", () => {
  test("shows credential labels and environment variables", () => {
    expect(
      IntegrationConnections.connectionSummary({
        connections: [
          { type: "credential", id: "cred_1", label: "Work" },
          { type: "env", name: "EXAMPLE_KEY" },
        ],
      }),
    ).toBe("Work, $EXAMPLE_KEY")
  })
})

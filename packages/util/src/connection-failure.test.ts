import { describe, expect, test } from "bun:test"
import { connectionFailure, firstConnectionFailure } from "./connection-failure.js"

class TransportError extends Error {
  readonly reason = "Transport"
}

describe("connection failure", () => {
  test("a rejected key is a credential failure with its status", () => {
    expect(connectionFailure(new Error("System One HTTP 401"))).toEqual({
      kind: "credential",
      status: 401,
      detail: "System One HTTP 401",
    })
    expect(connectionFailure(new Error("Invalid API key provided")).kind).toBe("credential")
  })

  test("another HTTP status keeps the code", () => {
    expect(connectionFailure(new Error("Generative connection failed (HTTP 429): slow down"))).toMatchObject({
      kind: "status",
      status: 429,
    })
    expect(
      connectionFailure(Object.assign(new Error("UnexpectedStatus: 502"), { cause: { status: 502 } })),
    ).toMatchObject({
      kind: "status",
      status: 502,
    })
  })

  test("an abort by the check deadline is a timeout", () => {
    const cause = new Error("The operation timed out.")
    cause.name = "TimeoutError"
    expect(connectionFailure(new TransportError("Transport: The operation timed out.", { cause })).kind).toBe("timeout")
  })

  test("network errors anywhere in the cause chain are unreachable", () => {
    const cause = Object.assign(new Error("Unable to connect"), { code: "ECONNREFUSED" })
    expect(connectionFailure(new TransportError("Transport", { cause }))).toEqual({
      kind: "unreachable",
      status: undefined,
      detail: "Transport",
    })
    expect(connectionFailure(new TransportError("Transport")).kind).toBe("unreachable")
  })

  test("checks run in order and stop at the first failure", async () => {
    const ran: string[] = []
    const failed = await firstConnectionFailure([
      { role: "principal", run: async () => ran.push("principal") },
      {
        role: "fast",
        run: async () => {
          ran.push("fast")
          throw new Error("System One HTTP 503")
        },
      },
      { role: "evaluator", run: async () => ran.push("evaluator") },
    ])
    expect(ran).toEqual(["principal", "fast"])
    expect(failed).toEqual({ role: "fast", failure: { kind: "status", status: 503, detail: "System One HTTP 503" } })
    expect(await firstConnectionFailure([{ role: "principal", run: async () => undefined }])).toBeUndefined()
  })

  test("anything else keeps its message as the detail", () => {
    expect(connectionFailure(new Error("Invalid System One response"))).toEqual({
      kind: "unknown",
      status: undefined,
      detail: "Invalid System One response",
    })
    expect(connectionFailure("plain").detail).toBe("plain")
  })
})

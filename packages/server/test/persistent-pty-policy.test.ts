import { describe, expect, test } from "bun:test"
import { terminalLaunchBinding } from "../src/persistent-pty-policy"
import type { HttpServerRequest } from "effect/unstable/http"

const request = (input?: { authorization?: string; host?: string; surface?: string }) =>
  ({
    headers: {
      authorization: input?.authorization,
      host: input?.host ?? "EXAMPLE.test:4096",
      "x-redcode-surface": input?.surface,
      "x-opencode-directory": "%2Frepo",
    },
    cookies: {},
  }) as HttpServerRequest.HttpServerRequest

const session = {
  projectID: "prj_test",
  location: { directory: "/repo", type: "local" },
  permissions: [{ permission: "bash", pattern: "*", action: "allow" }],
} as const

describe("persistent terminal launch policy", () => {
  test("is stable and records only opaque credential and policy fingerprints", () => {
    const first = terminalLaunchBinding({
      request: request({ authorization: "Basic secret", surface: "desktop" }),
      sessionID: "ses_test" as never,
      session: session as never,
      policy: { statements: [], organization: "Example" },
    })
    const second = terminalLaunchBinding({
      request: request({ authorization: "Basic secret", surface: "desktop" }),
      sessionID: "ses_test" as never,
      session: session as never,
      policy: { organization: "Example", statements: [] },
    })
    expect(first).toEqual(second)
    expect(first.origin).toBe("desktop")
    expect(first.scope.server).toBe("example.test:4096")
    expect(JSON.stringify(first)).not.toContain("secret")
  })

  test("changes when credentials or permissions are reduced", () => {
    const base = {
      request: request({ authorization: "Basic first" }),
      sessionID: "ses_test" as never,
      session: session as never,
      policy: { statements: [] },
    }
    const first = terminalLaunchBinding(base)
    const credential = terminalLaunchBinding({ ...base, request: request({ authorization: "Basic second" }) })
    const policy = terminalLaunchBinding({
      ...base,
      policy: { statements: [{ action: "tool.use", resource: "bash", effect: "deny" }] as never },
    })
    expect(credential.scope.credential).not.toBe(first.scope.credential)
    expect(policy.policyFingerprint).not.toBe(first.policyFingerprint)
  })
})

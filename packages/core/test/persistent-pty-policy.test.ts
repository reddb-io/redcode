import { describe, expect, test } from "bun:test"
import { sameLaunchBinding } from "../src/persistent-pty/index"

const launch = {
  origin: "desktop" as const,
  policyFingerprint: "policy-a",
  scope: { server: "server", location: "location", project: "project", credential: "credential" },
}

describe("persistent terminal policy binding", () => {
  test("accepts the exact launch scope", () => {
    expect(sameLaunchBinding(launch, { ...launch, scope: { ...launch.scope } })).toBeTrue()
  })

  test.each([
    ["policy", { ...launch, policyFingerprint: "policy-b" }],
    ["server", { ...launch, scope: { ...launch.scope, server: "other" } }],
    ["location", { ...launch, scope: { ...launch.scope, location: "other" } }],
    ["project", { ...launch, scope: { ...launch.scope, project: "other" } }],
    ["credential", { ...launch, scope: { ...launch.scope, credential: "other" } }],
  ])("rejects a changed %s scope", (_name, changed) => {
    expect(sameLaunchBinding(launch, changed)).toBeFalse()
  })
})

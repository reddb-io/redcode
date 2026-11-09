import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Harness } from "../src/harness.js"

test("negotiates rich harness features and preserves legacy controls", () => {
  const capabilities = Schema.decodeUnknownSync(Harness.Capabilities)({
    protocol: 1,
    features: { "run.background": 1, "mcp.apps": 2 },
    interrupt: true,
    resume: false,
    steer: false,
  })

  expect(Harness.supports(capabilities, Harness.Feature.backgroundWork)).toBe(true)
  expect(Harness.supports(capabilities, Harness.Feature.mcpApps, 2)).toBe(true)
  expect(Harness.supports(capabilities, Harness.Feature.interrupt)).toBe(true)
  expect(Harness.supports(capabilities, Harness.Feature.resume)).toBe(false)
})

test("decodes capabilities produced by an older harness server", () => {
  const capabilities = Schema.decodeUnknownSync(Harness.Capabilities)({
    interrupt: true,
    resume: true,
    steer: false,
  })

  expect(Harness.supports(capabilities, Harness.Feature.interrupt)).toBe(true)
  expect(Harness.supports(capabilities, Harness.Feature.resume)).toBe(true)
  expect(Harness.supports(capabilities, Harness.Feature.backgroundWork)).toBe(false)
})

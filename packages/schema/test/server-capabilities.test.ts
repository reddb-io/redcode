import { expect, test } from "bun:test"
import { Schema } from "effect"
import { ServerCapabilities } from "../src/server-capabilities.js"

test("decodes unknown versioned features for forward-compatible negotiation", () => {
  const info = Schema.decodeUnknownSync(ServerCapabilities.Info)({
    protocol: 1,
    features: { "event.resume": 2, "future.transport": 3 },
  })

  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.eventResume)).toBe(true)
  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.eventResume, 2)).toBe(true)
  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.eventResume, 3)).toBe(false)
  expect(ServerCapabilities.supports(info, "future.transport", 3)).toBe(true)
})

test("bridges old boolean capabilities without inferring unknown features", () => {
  const info = Schema.decodeUnknownSync(ServerCapabilities.Info)({
    sessionObservation: true,
    workerLease: false,
  })

  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.sessionObservation)).toBe(true)
  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.sessionObservation, 2)).toBe(false)
  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.workerLease)).toBe(false)
  expect(ServerCapabilities.supports(info, "event.resume")).toBe(false)
})

test("prefers an explicit versioned feature over its legacy boolean", () => {
  const info = Schema.decodeUnknownSync(ServerCapabilities.Info)({
    features: { "worker.lease": 2 },
    workerLease: false,
  })

  expect(ServerCapabilities.supports(info, ServerCapabilities.Feature.workerLease, 2)).toBe(true)
})

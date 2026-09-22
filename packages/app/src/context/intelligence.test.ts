import { expect, test } from "bun:test"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { createIntelligenceState } from "./intelligence"

const configured: Intelligence.Status = {
  settings: {
    enabled: true,
    onboarding: "completed",
    principal: { providerID: Provider.ID.make("provider"), id: Model.ID.make("principal") },
    evaluator: { transport: "typesafe", baseURL: "https://api.typesafe.ai/v1", model: "jev" },
  },
  environment: "/test",
  evaluators: [],
}

test("requires both configured roles, with optional transformations", async () => {
  const current = {
    status: { ...configured, settings: { enabled: false, onboarding: "deferred" } } as Intelligence.Status,
  }
  const service = createIntelligenceState({ get: async () => current.status, history: async () => [] })
  expect(service.ready()).toBe(false)
  expect(await service.refresh()).toBe(false)
  current.status = { ...configured, settings: { ...configured.settings, evaluator: undefined } }
  expect(await service.refresh()).toBe(false)
  current.status = configured
  expect(await service.refresh()).toBe(true)
  expect(service.state.status?.settings.fast).toBeUndefined()
})

test("failed refresh blocks stale readiness and a successful retry restores it", async () => {
  const current = { failed: false }
  const service = createIntelligenceState({
    get: async () => {
      if (current.failed) throw new Error("offline")
      return configured
    },
    history: async () => [],
  })
  expect(await service.refresh()).toBe(true)
  current.failed = true
  expect(await service.refresh()).toBe(false)
  expect(service.ready()).toBe(false)
  expect(service.state.status?.settings.principal?.id).toBe(Model.ID.make("principal"))
  current.failed = false
  expect(await service.refresh()).toBe(true)
})

test("deduplicates concurrent reads and isolates saved defaults between servers", async () => {
  const pending = Promise.withResolvers<Intelligence.Status>()
  const calls = { count: 0 }
  const first = createIntelligenceState({
    get: () => {
      calls.count++
      return pending.promise
    },
    history: async () => [],
  })
  const second = createIntelligenceState({ get: async () => configured, history: async () => [] })
  const reads = [first.refresh(), first.refresh()]
  expect(calls.count).toBe(1)
  pending.resolve(configured)
  expect(await Promise.all(reads)).toEqual([true, true])
  first.accept({
    ...configured.settings,
    principal: { providerID: Provider.ID.make("provider"), id: Model.ID.make("updated") },
  })
  await second.refresh()
  expect(first.state.status?.settings.principal?.id).toBe(Model.ID.make("updated"))
  expect(second.state.status?.settings.principal?.id).toBe(Model.ID.make("principal"))
})

test("an older status request cannot overwrite settings saved while it was pending", async () => {
  const response = Promise.withResolvers<Intelligence.Status>()
  const service = createIntelligenceState({ get: () => response.promise, history: async () => [] })
  const refreshing = service.refresh()
  service.accept(configured.settings)
  response.resolve({ ...configured, settings: { enabled: false, onboarding: "pending" } })
  expect(await refreshing).toBe(true)
  expect(service.ready()).toBe(true)
  expect(service.state.status?.settings.principal?.id).toBe(Model.ID.make("principal"))
})

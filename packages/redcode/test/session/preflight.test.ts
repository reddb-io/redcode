import { describe, expect, test } from "bun:test"
import { SessionPreflight } from "../../src/session/preflight"
import { hardLimit, usable } from "../../src/session/overflow"
import type { Provider } from "../../src/provider/provider"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"

const model = (limit: Provider.Model["limit"]) =>
  ({ id: "m", providerID: "p", api: { npm: "@ai-sdk/openai-compatible" }, limit }) as unknown as Provider.Model

describe("SessionPreflight.project", () => {
  test("projects from the provider's last count plus what history gained since", () => {
    expect(SessionPreflight.project({ estimate: 12_000, last: { counted: 10_000, gained: 3_000 } })).toBe(13_000)
    // History that shrank since the last request never projects below the provider's count.
    expect(SessionPreflight.project({ estimate: 5_000, last: { counted: 10_000, gained: -1 } })).toBe(10_000)
    // A count of zero is a provider that reports no usage: no evidence.
    expect(SessionPreflight.project({ estimate: 5_000, last: { counted: 0, gained: 100 } })).toBeUndefined()
  })

  test("scales the estimate by what the provider counted the last time it refused", () => {
    const observed = { input: 100_000, ratio: 1.5, at: 1, message: "m" }
    expect(SessionPreflight.project({ estimate: 10_000, observed })).toBe(15_000)
    expect(SessionPreflight.project({ estimate: 12_000, observed, last: { counted: 10_000, gained: 3_000 } })).toBe(
      14_500,
    )
    // The character estimate alone is no evidence: the provider decides.
    expect(SessionPreflight.project({ estimate: 10_000 })).toBeUndefined()
  })

  test("refuses on a learned limit, and on the catalog's only while the provider has not shown it wrong", () => {
    const observed = { input: 100_000, at: 1, message: "m" }
    expect(SessionPreflight.wouldRefuse({ projected: 130_000, limit: 120_000, accepted: 100_000 })).toBe(true)
    expect(SessionPreflight.wouldRefuse({ projected: 130_000, limit: 120_000 })).toBe(true)
    expect(SessionPreflight.wouldRefuse({ projected: 110_000, limit: 120_000, accepted: 100_000 })).toBe(false)
    // The provider accepted 121k against a 120k catalog limit: the catalog is wrong, not the request.
    expect(SessionPreflight.wouldRefuse({ projected: 130_000, limit: 120_000, accepted: 121_000 })).toBe(false)
    expect(SessionPreflight.wouldRefuse({ projected: 130_000, limit: 100_000, accepted: 121_000, observed })).toBe(true)
    expect(SessionPreflight.wouldRefuse({ projected: undefined, limit: 120_000 })).toBe(false)
    expect(SessionPreflight.wouldRefuse({ projected: 130_000, limit: 0 })).toBe(false)
  })

  test("counts the input the provider saw, cached or not", () => {
    expect(SessionPreflight.counted({ input: 1, output: 9, reasoning: 9, cache: { read: 2, write: 3 } })).toBe(6)
    expect(SessionPreflight.tokens(42)).toEqual({ input: 42, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
  })
})

describe("overflow limits", () => {
  const cfg = {} as ConfigV1.Info

  test("the learned input limit caps what a request may carry", () => {
    expect(hardLimit({ model: model({ context: 128_000, output: 8_000 }) })).toBe(120_000)
    expect(hardLimit({ model: model({ context: 128_000, input: 90_000, output: 8_000 }) })).toBe(90_000)
    expect(hardLimit({ model: model({ context: 0, output: 8_000 }) })).toBe(0)
    expect(usable({ cfg, model: model({ context: 128_000, input: 90_000, output: 8_000 }) })).toBe(82_000)
    expect(usable({ cfg, model: model({ context: 128_000, output: 8_000 }) })).toBe(120_000)
  })
})

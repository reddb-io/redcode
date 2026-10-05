import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ModelLimit } from "@opencode/core/model-limit"
import { ModelsDev } from "@opencode/core/models-dev"
import { catalogLimits, knownLimit, undescribedLimit } from "@opencode/core/plugin/provider/catalog-limits"

// Id shapes the bundled catalog really uses for one model, as listed by different providers.
const limits = new Map([
  ["glm-5.3-flash", { context: 1_000_000, output: 131_072 }],
  ["zai-org/GLM-5.3-Flash", { context: 1_048_576, output: 131_072 }],
  ["glm-5.3", { context: 1_000_000, output: 131_072 }],
  ["glm-5.3-flash@eu", { context: 1_000_000, output: 262_144 }],
  ["xiaomi/mimo-v2.6-pro", { context: 1_050_000, output: 131_072 }],
  ["mimo-v2.5-pro", { context: 1_048_576, output: 131_072 }],
  ["gpt-4o", { context: 128_000, output: 16_384 }],
  ["claude-sonnet", { context: 200_000, output: 64_000 }],
])

describe("knownLimit", () => {
  test("prefers the exact id, with leading gateway segments dropped", () => {
    expect(knownLimit(limits, "gpt-4o")).toEqual({ context: 128_000, output: 16_384 })
    expect(knownLimit(limits, "openai/gpt-4o")).toEqual({ context: 128_000, output: 16_384 })
    expect(knownLimit(limits, "cc/anthropic/claude-sonnet")?.context).toBe(200_000)
    expect(knownLimit(limits, "provider/zai-org/GLM-5.3-Flash")).toEqual({ context: 1_048_576, output: 131_072 })
    // The exact regional entry wins over the normalised base model.
    expect(knownLimit(limits, "glm-5.3-flash@eu")).toEqual({ context: 1_000_000, output: 262_144 })
    expect(knownLimit(limits, "unknown-model")).toBeUndefined()
  })

  test("tolerates case, variant and region suffixes and dots against dashes", () => {
    expect(knownLimit(limits, "GLM-5.3-Flash")).toEqual({ context: 1_000_000, output: 131_072 })
    expect(knownLimit(limits, "zai/glm-5.3-flash:free")).toEqual({ context: 1_000_000, output: 131_072 })
    expect(knownLimit(limits, "z-ai/glm-5.3-flash:thinking")).toEqual({ context: 1_000_000, output: 131_072 })
    expect(knownLimit(limits, "glm-5-3-flash")).toEqual({ context: 1_000_000, output: 131_072 })
    expect(knownLimit(limits, "glm-5.3-flash@us")).toEqual({ context: 1_000_000, output: 131_072 })
    expect(knownLimit(limits, "mimo-v2.6-pro")).toEqual({ context: 1_050_000, output: 131_072 })
    expect(knownLimit(limits, "XiaomiMiMo/MiMo-V2.6-Pro")).toEqual({ context: 1_050_000, output: 131_072 })
    expect(knownLimit(limits, "xiaomi/mimo-v2-6-pro")).toEqual({ context: 1_050_000, output: 131_072 })
  })

  test("never matches a bare family or a sibling model", () => {
    expect(knownLimit(new Map([["glm-5.3", { context: 1, output: 1 }]]), "glm-5.3-flash")).toBeUndefined()
    expect(knownLimit(new Map([["glm-5.3-flash", { context: 1, output: 1 }]]), "glm-5.3")).toBeUndefined()
    expect(knownLimit(limits, "mimo-v2.6-flash")).toBeUndefined()
    expect(knownLimit(limits, "glm-5.3-flashx")).toBeUndefined()
    expect(knownLimit(limits, "glm-5.3-flash-uncensored")).toBeUndefined()
    expect(knownLimit(limits, "umans-glm-5.3-flash")).toBeUndefined()
  })

  test("resolves the reported models through the bundled catalog", async () => {
    const bundled = catalogLimits(await Effect.runPromise(ModelsDev.bundled))
    expect(bundled.size).toBeGreaterThan(1_000)
    expect(catalogLimits(await Effect.runPromise(ModelsDev.bundled))).toBe(bundled)
    for (const id of [
      "glm-5.3-flash",
      "GLM-5.3-Flash",
      "z-ai/glm-5.3-flash",
      "zai/glm-5.3-flash:free",
      "glm-5.3-flash@eu",
      "provider/zai-org/GLM-5.3-Flash",
      "glm-5-3-flash",
      "mimo-v2.6-pro",
      "xiaomi/mimo-v2.6-pro",
      "XiaomiMiMo/MiMo-V2.6-Pro",
    ]) {
      const known = knownLimit(bundled, id)
      expect(known, id).toBeDefined()
      expect(known?.context, id).toBeGreaterThan(undescribedLimit.context)
    }
    expect(knownLimit(bundled, "no-such-model-anywhere")).toBeUndefined()
  })

  test("the guess for a model nobody described is the conservative 128k window", () => {
    expect(undescribedLimit).toEqual({ context: ModelLimit.conservative(128_000), output: 8_192 })
    expect(catalogLimits([]).size).toBe(0)
  })
})

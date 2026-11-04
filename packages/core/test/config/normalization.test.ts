import { expect, test } from "bun:test"
import { ConfigNormalize } from "@opencode/core/config/normalize"

test("accepts the current configuration without converting old keys", () => {
  expect(ConfigNormalize.normalize({ snapshots: false, agents: { reviewer: { system: "Review" } } })).toMatchObject({
    type: "normalized",
    encoded: { snapshots: false, agents: { reviewer: { system: "Review" } } },
    diagnostics: [],
  })
  for (const input of [
    { snapshot: false },
    { agent: { reviewer: { prompt: "Review" } } },
    { snapshots: true, snapshot: false },
    { agents: { reviewer: { prompt: "Review" } } },
    { mcp: { old: { type: "local", command: ["server"] } } },
  ]) {
    expect(ConfigNormalize.normalize(input)).toMatchObject({
      type: "rejected",
      diagnostics: [expect.objectContaining({ kind: "invalid", message: expect.stringContaining("redcode migrate") })],
    })
  }
})

test("loads unambiguous legacy settings in memory while rejecting loss and conflicts", () => {
  const legacy = {
    mcp: { blender: { type: "local", command: ["blender-mcp"], enabled: false } },
    permission: { bash: "deny" },
  }
  const copy = structuredClone(legacy)
  const result = ConfigNormalize.compatible(legacy)
  expect(result).toMatchObject({
    type: "normalized",
    converted: true,
    encoded: { mcp: { servers: { blender: { disabled: true } } }, permissions: [{ action: "shell", effect: "deny" }] },
  })
  expect(legacy).toEqual(copy)
  expect(ConfigNormalize.compatible({ snapshots: false })).toMatchObject({ type: "normalized", converted: false })
  for (const input of [
    { snapshot: false, future_option: "private-value" },
    { snapshot: false, snapshots: true },
    { mcp: { blender: { type: "local", command: ["server"], unexpected: "private-value" } } },
    { permission: { bash: 123 } },
  ]) {
    const rejected = ConfigNormalize.compatible(input)
    expect(rejected.type).toBe("rejected")
    expect(JSON.stringify(rejected)).not.toContain("private-value")
  }
})

test("preserves an explicit legacy autoshare opt-out across configuration layers", () => {
  expect(ConfigNormalize.compatible({ autoshare: false })).toMatchObject({
    type: "normalized",
    converted: true,
    encoded: { share: "manual" },
  })
  expect(ConfigNormalize.compatible({ autoshare: false, share: "auto" }).type).toBe("rejected")
})

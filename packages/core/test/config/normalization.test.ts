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

import { describe, expect, test } from "bun:test"
import type { Part } from "@reddb-io/redcode-sdk/v2/client"
import { latestDesignPreview } from "./session-design-preview"

const tool = (id: string, tool: string, status: "completed" | "running", metadata: Record<string, unknown> = {}) =>
  ({
    id,
    type: "tool",
    tool,
    sessionID: "s",
    messageID: "m",
    callID: id,
    state:
      status === "completed"
        ? { status, input: {}, output: "", title: "settings", metadata, time: { start: 0, end: 1 } }
        : { status, input: {}, title: "settings", metadata, time: { start: 0 } },
  }) as unknown as Part

describe("latestDesignPreview", () => {
  test("picks the newest completed preview, ignoring other tools and unfinished calls", () => {
    const parts: Record<string, Part[]> = {
      m1: [tool("c1", "design_preview", "completed", { id: "old", revision: 1 })],
      m2: [
        tool("c2", "read", "completed", { id: "nope" }),
        tool("c3", "design_preview", "completed", { id: "new", revision: 3 }),
      ],
      m3: [tool("c4", "design_preview", "running", { id: "later" })],
    }
    const found = latestDesignPreview([{ id: "m1" }, { id: "m2" }, { id: "m3" }], (id) => parts[id] ?? [])
    expect(found).toEqual({ id: "new", name: "settings", revision: 3 })
  })

  test("nothing when no preview was ever opened", () => {
    expect(latestDesignPreview([{ id: "m1" }], () => [])).toBeUndefined()
  })
})

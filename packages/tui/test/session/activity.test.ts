import { describe, expect, test } from "bun:test"
import { describeActivity, describeStall, STALL_NOTICE_SECONDS, type ActivityPart } from "../../src/session/activity"

const tool = (tool: string, status: string, input?: Record<string, unknown>): ActivityPart => ({
  type: "tool",
  tool,
  state: { status, input },
})

describe("describeActivity", () => {
  test("names the file a running edit is touching", () => {
    expect(describeActivity([tool("edit", "running", { filePath: "src/session/prompt.ts" })])).toBe(
      "Editing src/session/prompt.ts",
    )
  })

  test("names the command a shell is running", () => {
    expect(describeActivity([tool("bash", "running", { command: "cargo test --all" })])).toBe("Running cargo test --all")
  })

  test("keeps the tail of a long path, which is the informative half", () => {
    const label = describeActivity([tool("read", "running", { filePath: "/very/deep/nested/tree/of/dirs/target.ts" })], 24)
    expect(label!.startsWith("Reading")).toBe(true)
    expect(label!.endsWith("target.ts")).toBe(true)
    expect(label!.length).toBeLessThanOrEqual(24)
  })

  test("falls back to the verb when the tool reports no useful argument", () => {
    expect(describeActivity([tool("grep", "running", {})])).toBe("Searching")
  })

  test("reports reasoning as thinking and streamed text as responding", () => {
    expect(describeActivity([{ type: "reasoning", text: "..." }])).toBe("Thinking")
    expect(describeActivity([{ type: "text", text: "here is" }])).toBe("Responding")
  })

  test("prefers the running tool over earlier reasoning", () => {
    expect(
      describeActivity([{ type: "reasoning", text: "..." }, tool("write", "running", { filePath: "a.ts" })]),
    ).toBe("Writing a.ts")
  })

  test("says it is waiting when nothing has come back yet", () => {
    // The stalled-request case: a spinner alone is indistinguishable from progress.
    expect(describeActivity([])).toBe("Waiting for the model")
    expect(describeActivity([tool("bash", "completed", { command: "ls" })])).toBe("Waiting for the model")
  })

  test("describes an unknown tool by its own title", () => {
    expect(describeActivity([{ type: "tool", tool: "mcp_thing", state: { status: "running", title: "Sync repo" } }])).toBe(
      "Sync repo",
    )
  })
})

describe("describeStall", () => {
  test("stays quiet while a turn is still young", () => {
    expect(describeStall(0, "Thinking")).toBeUndefined()
    expect(describeStall(STALL_NOTICE_SECONDS - 1, "Thinking")).toBeUndefined()
  })

  test("says plainly that nothing has arrived once it has been a while", () => {
    expect(describeStall(STALL_NOTICE_SECONDS, "Waiting for the model")).toBe("no response from the model yet")
    expect(describeStall(600, "Running cargo build")).toBe("no new output yet")
  })
})

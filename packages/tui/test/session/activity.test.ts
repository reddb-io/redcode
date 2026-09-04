import { describe, expect, test } from "bun:test"
import { describeBusy, describeActivity, describeStall, STALL_NOTICE_SECONDS, type ActivityPart } from "../../src/session/activity"

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

  test("says which step a long turn is on, which no part ever carries", () => {
    // Eight steps in with nothing on screen is a very different picture from a turn that just
    // started, and it is the one people read as a freeze.
    expect(describeBusy({ type: "busy", phase: "thinking", step: 8 }, "Thinking")).toBe("Thinking · step 8")
    expect(describeBusy({ type: "busy", phase: "thinking", step: 1 }, "Thinking")).toBe("Thinking")
  })

  test("falls back to what the server says before any part has arrived", () => {
    // The window this covers is exactly the silent one: request sent, nothing back yet.
    expect(describeBusy({ type: "busy", phase: "tool", tool: "bash" }, undefined)).toBe("Running bash")
    expect(describeBusy({ type: "busy" }, undefined)).toBe("Waiting for the model")
    expect(describeBusy({ type: "idle" }, undefined)).toBeUndefined()
  })
})

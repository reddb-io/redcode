import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { codeFrame } from "../src/interpreter/runtime.js"
import { isReadStyle } from "../src/tool-runtime.js"

const text = (description: string, input: Schema.Top = Schema.Struct({ id: Schema.String })) =>
  Tool.make({ description, input: input as Schema.Decoder<unknown>, run: () => Effect.succeed("ok") })

describe("syntax errors", () => {
  test("a TypeScript parse error carries line, column and a code frame", async () => {
    const runtime = CodeMode.make({ tools: {} })
    const result = await Effect.runPromise(runtime.execute("const a = 1\nconst b = ;\nreturn a"))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("ParseError")
    expect(result.error.location).toStrictEqual({ line: 2, column: 11 })
    expect(result.error.message).toContain("(line 2, col 11)")
    expect(result.error.message).toContain("2 | const b = ;\n  |           ^")
  })

  test("the frame windows long lines around the caret", () => {
    const line = "x".repeat(300) + "!"
    const frame = codeFrame(line, 1, 301)
    const [source, caret] = frame.split("\n")
    expect(source!.length).toBeLessThanOrEqual(104)
    expect(source).toContain("!")
    expect(caret!.indexOf("^") - 4).toBe(source!.indexOf("!") - 4)
  })
})

describe("flat tool names", () => {
  const runtime = CodeMode.make({ tools: { github: { issue_read: text("Read an issue") } } })

  test("a flat MCP-style name suggests the dotted path", async () => {
    const result = await Effect.runPromise(runtime.execute("return await tools.github_issue_read({ id: '1' })"))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("UnknownTool")
    expect(result.error.suggestions?.[0]).toBe(
      "Did you mean tools.github.issue_read? Tool paths use dots between namespace and tool.",
    )
  })

  test("a half-flat name under the namespace suggests the dotted path too", async () => {
    const result = await Effect.runPromise(runtime.execute("return await tools.github.github_issue_read({ id: '1' })"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.suggestions?.[0]).toContain("tools.github.issue_read")
  })

  test("an unrelated unknown name gets no path suggestion", async () => {
    const result = await Effect.runPromise(runtime.execute("return await tools.github.merge({ id: '1' })"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.suggestions?.join("\n")).not.toContain("Did you mean")
  })
})

describe("catalog ranking", () => {
  // Many parameters make the read tool the most expensive line in its namespace.
  const readIssue = text(
    "Read an issue",
    Schema.Struct({
      owner: Schema.String,
      repository: Schema.String,
      issue_number: Schema.Number,
      include_comments: Schema.optionalKey(Schema.Boolean),
    }),
  )
  const setLabel = text("Set a label")
  const lockIssue = text("Lock an issue so that only collaborators can comment on it")

  // The same estimate the catalog charges: chars/4 of the rendered line.
  const lineCost = (tools: Parameters<typeof CodeMode.make>[0], path: string) => {
    const entry = CodeMode.make(tools)
      .catalog()
      .find((item) => item.path === path)!
    return Math.round(`  - ${entry.signature} // ${entry.description}`.length / 4)
  }

  test("read-style names are recognized across naming styles", () => {
    expect(isReadStyle("github.issue_read")).toBe(true)
    expect(isReadStyle("github.list_issues")).toBe(true)
    expect(isReadStyle("github.getMe")).toBe(true)
    expect(isReadStyle("linear.search")).toBe(true)
    expect(isReadStyle("github.create_issue")).toBe(false)
  })

  test("a read-style tool is inlined before cheaper tools", () => {
    const tools = { github: { set_label: setLabel, issue_read: readIssue, lock_issue: lockIssue } }
    const readCost = lineCost({ tools }, "github.issue_read")
    // Cheapest-first would place set_label and then have no room for the read.
    expect(lineCost({ tools }, "github.set_label")).toBeLessThan(readCost)
    const runtime = CodeMode.make({ tools, discovery: { catalogBudget: readCost + 1 } })
    const instructions = runtime.instructions()
    expect(instructions).toContain("- github (3 tools, 1 shown)")
    expect(instructions).toContain("tools.github.issue_read(")
    expect(instructions).not.toContain("tools.github.set_label(")
  })

  test("tools the session already used come next, ahead of cheaper unused ones", () => {
    const tools = { github: { set_label: setLabel, lock_issue: lockIssue } }
    const lockCost = lineCost({ tools }, "github.lock_issue")
    expect(lineCost({ tools }, "github.set_label")).toBeLessThan(lockCost)
    const runtime = CodeMode.make({
      tools,
      discovery: { catalogBudget: lockCost + 1, recent: ["github.lock_issue"] },
    })
    const instructions = runtime.instructions()
    expect(instructions).toContain("- github (2 tools, 1 shown)")
    expect(instructions).toContain("tools.github.lock_issue(")
    expect(instructions).not.toContain("tools.github.set_label(")
  })
})

import { describe, expect, test } from "bun:test"
import { dynamicTool, jsonSchema, tool, type Tool } from "ai"
import { LLMRequestPrep } from "../../src/session/llm/request"

const schema = jsonSchema({ type: "object", properties: { value: { type: "string" } } })
const native = (description: string): Tool => tool({ description, inputSchema: schema })
const mcp = (description: string): Tool => dynamicTool({ description, inputSchema: schema, execute: async () => "" })

const order = LLMRequestPrep.orderTools
const names = (tools: Record<string, Tool>) => Object.keys(tools)
// What a provider's prefix cache sees: every advertised tool, in order.
const serialize = (tools: Record<string, Tool>) =>
  JSON.stringify(Object.entries(tools).map(([name, item]) => ({ name, description: item.description })))
const preserved = (previous: Record<string, Tool>, next: Record<string, Tool>) => {
  const a = serialize(previous)
  const b = serialize(next)
  let common = 0
  while (common < a.length && a[common] === b[common]) common++
  return { common, length: a.length, percent: (100 * common) / a.length }
}

const natives = { write: native("Write"), bash: native("Bash"), lsp: native("LSP"), read: native("Read") }
const github = { github_list_issues: mcp("List issues"), github_issue_read: mcp("Read issue") }
const linear = { linear_search_issues: mcp("Search Linear"), linear_create_issue: mcp("Create Linear issue") }

describe("session.llm.request orderTools", () => {
  test("advertises native, resource, tool_search, direct MCP and activated tools as separate blocks", () => {
    const tools = {
      linear_search_issues: mcp("Search Linear"),
      write: native("Write"),
      github_deferred: mcp("Loaded through tool_search"),
      tool_search: native("Search tools"),
      read_mcp_resource: native("Read resource"),
      bash: native("Bash"),
      github_issue_read: mcp("Read issue"),
      list_mcp_resources: native("List resources"),
    }
    expect(names(order({ tools, serverOrder: ["github", "linear"], activation: ["github_deferred"] }))).toEqual([
      "bash",
      "write",
      "list_mcp_resources",
      "read_mcp_resource",
      "tool_search",
      "github_issue_read",
      "linear_search_issues",
      "github_deferred",
    ])
  })

  test("native tools keep one order whatever MCP tools are loaded", () => {
    expect(names(order({ tools: natives }))).toEqual(["bash", "lsp", "read", "write"])
    expect(names(order({ tools: { ...linear, ...natives, ...github } })).slice(0, 4)).toEqual([
      "bash",
      "lsp",
      "read",
      "write",
    ])
  })

  test("direct MCP tools follow the durable server order, then each server's own tool order", () => {
    // Linear finished connecting first; github comes first in config.
    const tools = { ...natives, ...linear, ...github }
    expect(names(order({ tools, serverOrder: ["github", "linear"] })).slice(4)).toEqual([
      "github_list_issues",
      "github_issue_read",
      "linear_search_issues",
      "linear_create_issue",
    ])
    // Without an explicit order the caller's insertion order stands (MCP.tools() is already durable).
    expect(names(order({ tools })).slice(4)).toEqual([
      "linear_search_issues",
      "linear_create_issue",
      "github_list_issues",
      "github_issue_read",
    ])
  })

  test("a tool belongs to the server with the longest matching prefix", () => {
    const tools = { github_tool: mcp("github"), git_tool: mcp("git") }
    expect(names(order({ tools, serverOrder: ["git", "github"] }))).toEqual(["git_tool", "github_tool"])
    expect(names(order({ tools, serverOrder: ["github", "git"] }))).toEqual(["github_tool", "git_tool"])
  })

  test("a server connecting mid-session preserves the whole previous prefix", () => {
    const before = order({ tools: { ...natives, ...github }, serverOrder: ["github"] })
    // linear_* sorts before lsp by name: sorting by name used to interleave it with the natives.
    const after = order({ tools: { ...linear, ...natives, ...github }, serverOrder: ["github", "linear"] })
    const result = preserved(before, after)
    // Everything but the closing bracket survives.
    expect(result.common).toBe(result.length - 1)
    expect(result.percent).toBeGreaterThan(99)

    const byName = (tools: Record<string, Tool>) =>
      Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)))
    expect(preserved(byName(before), byName(after)).percent).toBeLessThan(result.percent)
  })

  test("activating deferred tools appends and never re-sorts earlier activations", () => {
    const deferred = { github_zeta: mcp("Zeta"), github_alpha: mcp("Alpha"), linear_beta: mcp("Beta") }
    const tools = { ...natives, ...github, ...deferred, tool_search: native("Search tools") }
    const first = order({ tools, serverOrder: ["github", "linear"], activation: ["github_zeta"] })
    const second = order({ tools, serverOrder: ["github", "linear"], activation: ["github_zeta", "github_alpha"] })
    const third = order({
      tools,
      serverOrder: ["github", "linear"],
      activation: ["github_zeta", "github_alpha", "linear_beta"],
    })
    // Tools not yet activated are still in the direct MCP block in these inputs, so compare the
    // activated tail: it grows at the end in activation order.
    expect(names(third).slice(-3)).toEqual(["github_zeta", "github_alpha", "linear_beta"])

    const loaded = (activation: string[]) =>
      order({
        tools: { ...natives, ...github, tool_search: native("Search tools"), ...Object.fromEntries(activation.map((name) => [name, deferred[name as keyof typeof deferred]])) },
        serverOrder: ["github", "linear"],
        activation,
      })
    const a = loaded(["github_zeta"])
    const b = loaded(["github_zeta", "linear_beta"])
    const c = loaded(["github_zeta", "linear_beta", "github_alpha"])
    for (const [previous, next] of [
      [a, b],
      [b, c],
    ] as const) {
      const result = preserved(previous, next)
      expect(result.common).toBe(result.length - 1)
    }
    expect(names(c).slice(-3)).toEqual(["github_zeta", "linear_beta", "github_alpha"])
    expect(names(first).at(-1)).toBe("github_zeta")
    expect(names(second).slice(-2)).toEqual(["github_zeta", "github_alpha"])
  })
})

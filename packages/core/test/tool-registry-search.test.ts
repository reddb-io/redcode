import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Location } from "../src/location"
import { Tool } from "../src/tool/tool"
import { ToolRegistry } from "../src/tool/registry"
import { ToolSearch } from "../src/tool/tool-search"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [[Location.node, tempLocationLayer]]))

const tool = (description: string) =>
  Tool.make({
    description,
    input: Schema.Struct({ query: Schema.String.pipe(Schema.optional) }),
    output: Schema.Struct({}),
    execute: () => Effect.succeed({}),
  })

const names = (materialization: ToolRegistry.Materialization) =>
  materialization.definitions.map((definition) => definition.name)

const identity = {
  agent: "build" as never,
  assistantMessageID: "msg_search" as never,
}
const sessionID = "ses_tool_search" as never

/** Always defer MCP tools, so the test does not depend on the schema-size threshold. */
const always = { config: { enabled: true as const }, servers: ["github"] }

it.effect("withholds deferred tools and advertises tool_search instead", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({
      github_list_issues: Tool.external(tool("List issues in a repository")),
      github_merge_pull_request: Tool.external(tool("Merge a pull request")),
      read: tool("Read a file"),
    })

    const materialized = yield* registry.materialize({ deferral: always })

    // Built-ins stay advertised; the two MCP tools are replaced by the search tool.
    expect(names(materialized)).toContain("read")
    expect(names(materialized)).toContain(ToolSearch.TOOL_ID)
    expect(names(materialized)).not.toContain("github_list_issues")
    expect(names(materialized)).not.toContain("github_merge_pull_request")
    // The index rides the system context, not the tool description.
    expect(materialized.toolIndex).toContain("github (2)")
    expect(materialized.toolIndex).toContain("list_issues")
    expect(materialized.native).toBeUndefined()
  }),
)

it.effect("advertises everything when nothing is deferred", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({ github_list_issues: Tool.external(tool("List issues")), read: tool("Read a file") })

    const materialized = yield* registry.materialize()

    expect(names(materialized)).toContain("github_list_issues")
    expect(names(materialized)).not.toContain(ToolSearch.TOOL_ID)
    expect(materialized.toolIndex).toBeUndefined()
  }),
)

it.effect("loads a deferred tool by name and reports what it loaded", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({ github_list_issues: Tool.external(tool("List issues in a repository")) })
    const materialized = yield* registry.materialize({ deferral: always })

    const settled = yield* materialized.settle({
      sessionID,
      ...identity,
      call: {
        type: "tool-call",
        id: "call-search",
        name: ToolSearch.TOOL_ID,
        input: { select: ["github_list_issues"] },
      },
    })

    expect(settled.output?.structured).toMatchObject({ loaded: ["github_list_issues"], mcpDeferred: true })
    expect(String(settled.result.value)).toContain("github_list_issues")
  }),
)

it.effect("advertises a tool the Session already loaded", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({
      github_list_issues: Tool.external(tool("List issues")),
      github_merge_pull_request: Tool.external(tool("Merge a pull request")),
    })

    const materialized = yield* registry.materialize({
      deferral: { ...always, loaded: ["github_list_issues"] },
    })

    expect(names(materialized)).toContain("github_list_issues")
    expect(names(materialized)).not.toContain("github_merge_pull_request")
    // The search tool stays present once anything is deferrable, so the advertised prefix is stable.
    expect(names(materialized)).toContain(ToolSearch.TOOL_ID)
  }),
)

it.effect("advertises loaded tools in activation order, after everything stable", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({
      read: tool("Read a file"),
      github_list_issues: Tool.external(tool("List issues")),
      github_merge_pull_request: Tool.external(tool("Merge a pull request")),
      github_search_code: Tool.external(tool("Search code")),
    })

    // Loaded second, then first: the advertised order must follow activation, not registration.
    const materialized = yield* registry.materialize({
      deferral: { ...always, loaded: ["github_merge_pull_request", "github_list_issues"] },
    })

    // Positional, not membership: a prefix that reshuffles re-bills every cached tool after it.
    expect(names(materialized)).toEqual([
      "read",
      ToolSearch.TOOL_ID,
      "github_merge_pull_request",
      "github_list_issues",
    ])

    // Loading one more appends to the end and leaves the prefix byte-identical.
    const next = yield* registry.materialize({
      deferral: { ...always, loaded: ["github_merge_pull_request", "github_list_issues", "github_search_code"] },
    })
    expect(names(next).slice(0, 4)).toEqual(names(materialized))
    expect(names(next).at(-1)).toBe("github_search_code")
  }),
)

it.effect("never lists or loads a tool the permission rules disable", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({
      github_list_issues: Tool.external(tool("List issues in a repository")),
      github_secret_tool: Tool.external(tool("Something denied")),
    })

    const materialized = yield* registry.materialize({
      permissions: [{ action: "github_secret_tool", resource: "*", effect: "deny" }],
      deferral: always,
    })

    // A denied tool is filtered before the plan, so it is neither advertised nor in the index.
    expect(names(materialized)).not.toContain("github_secret_tool")
    expect(materialized.toolIndex).not.toContain("secret_tool")
    expect(materialized.toolIndex).toContain("list_issues")

    const settled = yield* materialized.settle({
      sessionID,
      ...identity,
      call: {
        type: "tool-call",
        id: "call-denied",
        name: ToolSearch.TOOL_ID,
        input: { select: ["github_secret_tool"] },
      },
    })
    expect(String(settled.result.value)).toContain("Unknown tool: github_secret_tool")
    expect(settled.output?.structured).toMatchObject({ loaded: [] })
  }),
)

it.effect("ignores a loaded name that is no longer registered", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({ github_list_issues: Tool.external(tool("List issues")) })

    // A server that went away between turns leaves its name in the Session's history.
    const materialized = yield* registry.materialize({
      deferral: { ...always, loaded: ["github_gone", "github_list_issues"] },
    })

    expect(names(materialized)).toEqual([ToolSearch.TOOL_ID, "github_list_issues"])
  }),
)

it.effect("sends deferred definitions flagged, without the client tool, in native mode", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({ github_list_issues: Tool.external(tool("List issues")) })

    const materialized = yield* registry.materialize({ deferral: { ...always, native: "anthropic" } })

    expect(names(materialized)).toContain("github_list_issues")
    expect(names(materialized)).not.toContain(ToolSearch.TOOL_ID)
    expect(materialized.definitions.find((item) => item.name === "github_list_issues")?.deferLoading).toBe(true)
    expect(materialized.native).toBe("anthropic")
  }),
)

it.effect("refuses a search call with neither query nor select as an ordinary tool error", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* registry.register({ github_list_issues: Tool.external(tool("List issues")) })
    const materialized = yield* registry.materialize({ deferral: always })

    const settled = yield* materialized.settle({
      sessionID,
      ...identity,
      call: { type: "tool-call", id: "call-empty", name: ToolSearch.TOOL_ID, input: {} },
    })

    expect(settled.result.type).toBe("error")
    expect(String(settled.result.value)).toContain("query")
  }),
)

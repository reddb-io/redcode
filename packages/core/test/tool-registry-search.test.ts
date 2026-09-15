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

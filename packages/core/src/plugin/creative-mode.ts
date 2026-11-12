import type { Context } from "@opencode/plugin/effect/plugin"
import type { Design } from "@opencode/schema/design"
import { Effect, Stream } from "effect"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Mcp } from "../mcp/index.js"
import { McpEvent } from "@opencode/schema/mcp-event"
import { McpTool } from "../tool/mcp.js"
import { Wildcard } from "../util/wildcard.js"

/** Shared artifact workspace, separate deliverables and tool catalogs. Host implementation belongs to Build. */
export const apply = Effect.fn("CreativeMode.apply")(function* (
  ctx: Context,
  role: Design.CreativeRole,
  instructions: { name: string; description: string; system: string },
) {
  const mcp = yield* Mcp.Service
  const bus = yield* Bus.Service
  const loaded = { tools: yield* mcp.tools() }
  yield* Stream.merge(bus.subscribe(McpEvent.ToolsChanged), bus.subscribe(McpEvent.StatusChanged)).pipe(
    Stream.runForEach(() =>
      mcp.tools().pipe(
        Effect.tap((tools) => Effect.sync(() => (loaded.tools = tools))),
        Effect.andThen(ctx.agent.reload()),
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* ctx.agent.transform((editor) =>
    editor.update(Agent.ID.make(role), (item) => {
      const configured = item.permissions.slice()
      const mcpPermissions = loaded.tools.flatMap((tool) => {
        const action = McpTool.name(tool.server, tool.name)
        return [
          { action, resource: "*", effect: "ask" as const },
          ...configured.filter((rule) => Wildcard.match(action, rule.action)).map((rule) => ({ ...rule, action })),
        ]
      })
      item.name = Agent.Name.make(instructions.name)
      item.description = instructions.description
      item.system = instructions.system
      item.mode = "primary"
      item.permissions.push(
        { action: "*", resource: "*", effect: "deny" },
        ...[
          "read",
          "glob",
          "grep",
          "webfetch",
          "websearch",
          "skill",
          "question",
          "session_history",
          "todo*",
          "goal_status",
          "goal_complete",
          "models",
          "worktree_prepare",
          "execute",
          ...(role === "design"
            ? ["design_*"]
            : [
                "design_document",
                "design_detect",
                "design_read",
                "design_preview",
                "design_history",
                "design_link",
                "design_asset",
                "design_media",
                "design_generate",
                "design_export",
                "design_jobs",
                "design_edit",
                "design_collaboration",
                "session_artifact",
                "creator_component",
                "creator_component_edit",
              ]),
        ].map((action) => ({ action, resource: "*", effect: "allow" as const })),
        ...mcpPermissions,
        { action: "design_handoff", resource: "*", effect: "ask" },
        { action: "read", resource: "*.env", effect: "ask" },
        { action: "read", resource: "*.env.*", effect: "ask" },
        { action: "read", resource: "*.env.example", effect: "allow" },
        { action: "subagent", resource: "explore", effect: "allow" },
        { action: "project_tooling", resource: "*", effect: "ask" },
        { action: "external_directory", resource: "*", effect: "ask" },
        { action: "external_directory", resource: "*/.red/code/design/*/work/*", effect: "allow" },
        { action: "edit", resource: ".red/code/design/*/work/*", effect: "allow" },
        { action: "edit", resource: "*/.red/code/design/*/work/*", effect: "allow" },
        ...configured.filter((rule) => rule.effect === "deny"),
      )
    }),
  )
})

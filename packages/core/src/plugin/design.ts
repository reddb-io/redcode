export * as DesignPlugin from "./design.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { DesignPrompt } from "../design/prompt.js"
import { Mcp } from "../mcp/index.js"
import { McpTool } from "../tool/mcp.js"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Wildcard } from "../util/wildcard.js"

export const Plugin = define({
  id: "redcode.design",
  effect: Effect.fn(function* (ctx) {
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const loaded = { tools: [] as Mcp.Tool[] }
    yield* Stream.merge(bus.subscribe(McpEvent.ToolsChanged), bus.subscribe(McpEvent.StatusChanged)).pipe(
      Stream.runForEach(() =>
        mcp.tools().pipe(
          Effect.tap((tools) => Effect.sync(() => (loaded.tools = tools))),
          Effect.andThen(ctx.agent.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.tools = yield* mcp.tools()
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("design"), (item) => {
        // Preserve the configured policy for real MCP actions, without restoring Build grants.
        const permissions = loaded.tools.flatMap((tool) => {
          const action = McpTool.name(tool.server, tool.name)
          return [
            { action, resource: "*", effect: "ask" as const },
            ...item.permissions
              .filter((rule) => Wildcard.match(action, rule.action))
              .map((rule) => ({ ...rule, action })),
          ]
        })
        item.name = Agent.Name.make("Design")
        item.description =
          "Build an interactive prototype for browser review and turn approved decisions into a Plan handoff."
        item.system = DesignPrompt.instructions
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
            "design_*",
            "todo*",
            "goal_status",
            "goal_complete",
            "models",
            "worktree_prepare",
            "execute",
          ].map((action) => ({ action, resource: "*", effect: "allow" as const })),
          ...permissions,
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "explore", effect: "allow" },
          { action: "project_tooling", resource: "*", effect: "ask" },
          { action: "external_directory", resource: "*", effect: "ask" },
          { action: "external_directory", resource: "*/.red/code/design/*/work/*", effect: "allow" },
          { action: "edit", resource: ".red/code/design/*/work/*", effect: "allow" },
          { action: "edit", resource: "*/.red/code/design/*/work/*", effect: "allow" },
        )
      })
    })
  }),
})

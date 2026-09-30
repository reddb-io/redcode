import { describe, expect } from "bun:test"
import { Effect, Layer, type Types } from "effect"
import { Design } from "@opencode/schema/design"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { DesignRenderer } from "@opencode/core/design/renderer"
import { DesignStore } from "@opencode/core/design/store"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { DesignPlugin } from "@opencode/core/plugin/design"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { DesignPlaybookTool } from "@opencode/core/tool/plugin/design-playbook"
import { DesignReadTool } from "@opencode/core/tool/plugin/design-read"
import { DesignRenderTool } from "@opencode/core/tool/plugin/design-render"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { it, testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"
import { host } from "./plugin/host"

const sessionID = Session.ID.make("ses_design_tools")
const designID = Design.ID.make("design_tools")

const stored: Design.Info = {
  id: designID,
  sessionID,
  name: "Checkout",
  journey: "existing",
  engine: "html",
  kind: "screen",
  target: "web",
  root: "/project/.red/code/design/design_tools/work",
  application: "/project",
  entry: "index.html",
  brief: { objective: "", audience: "", content: "", constraints: "", references: [] },
  decisions: [],
  questions: [],
  scenarios: [],
  designSystem: "",
  sources: [],
  tweaks: {},
  revision: "rev_one",
  approvedRevision: null,
  ended: false,
  updated: 1,
}

const queued: Design.Job = {
  id: "job_export",
  designID,
  input: { revision: "rev_one", format: "html" },
  status: "queued",
  progress: 0,
  result: null,
  error: null,
  created: 1,
}

// What the tools asked of their collaborators, reset before every test.
const assertions: Permission.AssertInput[] = []
const reads: Array<typeof DesignReadTool.Input.Type> = []
const started: Design.Render[] = []

const reset = () =>
  Effect.sync(() => {
    assertions.length = 0
    reads.length = 0
    started.length = 0
  })

const store = Layer.mock(DesignStore.Service, {
  storage: "/design/store",
  blobs: "/design/blobs",
  get: (_session, id) =>
    id === designID
      ? Effect.succeed(stored)
      : Effect.fail(new Design.Error({ code: "not-found", message: "Design not found in this session" })),
  readApproval: (_session, input) =>
    Effect.sync(() => {
      reads.push(input)
      return `Revision rev_one (not approved), section ${input.section ?? "summary"}.`
    }),
})

const renderer = Layer.mock(DesignRenderer.Service, {
  start: (_session, id, input) =>
    Effect.sync(() => {
      started.push(input)
      return { ...queued, designID: id, input }
    }),
  jobs: () => Effect.succeed([queued]),
})

const designToolsNode = makeLocationNode({
  name: "test/design-tool-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(DesignReadTool.Plugin)
      yield* registerToolPlugin(DesignRenderTool.Plugin)
      yield* registerToolPlugin(DesignPlaybookTool.Plugin)
    }),
  ),
  deps: [Tool.node, Permission.node, DesignStore.node, DesignRenderer.node],
})

const tools = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, designToolsNode]), [
    Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })),
    Image.node.replace(imagePassthrough),
    DesignStore.node.replace(store),
    DesignRenderer.node.replace(renderer),
  ]),
)

const call = (name: string, input: unknown, id = `call_${name}`) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

describe("Design tools", () => {
  tools.effect("registers the review, export and playbook tools outside Code Mode", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const names = (yield* toolDefinitions(registry)).map((tool) => tool.name)

      expect(names).toEqual(expect.arrayContaining(["design_read", "design_export", "design_jobs", "design_playbook"]))
    }),
  )

  tools.effect("reads a Design revision after asking permission for that design", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service

      expect(yield* executeTool(registry, call("design_read", { id: designID, section: "decisions" }))).toMatchObject({
        status: "completed",
        output: "Revision rev_one (not approved), section decisions.",
        metadata: { designID },
      })
      expect(assertions).toMatchObject([
        { sessionID, action: "design_read", resources: [designID], save: [designID], agent: toolIdentity.agent },
      ])
      expect(reads).toEqual([{ id: designID, section: "decisions" }])
    }),
  )

  tools.effect("refuses to read prototype files out of a page snapshot", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const result = yield* executeTool(
        registry,
        call("design_read", { id: designID, section: "snapshot", file: "index.html" }),
      )

      expect(result.status).toBe("error")
      expect(reads).toEqual([])
    }),
  )

  tools.effect("rejects an invalid design id before any permission request", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service

      expect((yield* executeTool(registry, call("design_read", { id: "checkout" }))).status).toBe("error")
      expect(assertions).toEqual([])
    }),
  )

  tools.effect("starts an export only for a design of this Session and reports the job", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const exported = yield* executeTool(
        registry,
        call("design_export", { id: designID, input: { revision: "rev_one", format: "html" } }),
      )

      expect(exported).toMatchObject({ status: "completed", metadata: { designID, jobID: "job_export" } })
      expect(started).toEqual([{ revision: "rev_one", format: "html" }])
      expect(assertions.map((item) => [item.action, item.resources])).toEqual([["design_export", [designID]]])

      const missing = yield* executeTool(
        registry,
        call("design_export", { id: Design.ID.make("design_other"), input: { revision: "rev_one", format: "pdf" } }),
      )
      expect(missing.status).toBe("error")
      expect(started).toHaveLength(1)
    }),
  )

  tools.effect("polls jobs with the audit report of the current revision", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const polled = yield* executeTool(registry, call("design_jobs", { id: designID }))

      expect(polled).toMatchObject({
        status: "completed",
        output: { jobs: [queued], revision: "rev_one", notes: [] },
      })
      expect(assertions.map((item) => item.action)).toEqual(["design_jobs"])
    }),
  )

  tools.effect("reads a playbook and names the known ones for an unknown id", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const flow = yield* executeTool(registry, call("design_playbook", { id: "flow" }))
      const unknown = yield* executeTool(registry, call("design_playbook", { id: "nope" }))

      expect(flow).toMatchObject({ status: "completed", metadata: { playbook: "flow" } })
      expect(unknown.status).toBe("error")
      expect(assertions.map((item) => [item.action, item.resources])).toEqual([
        ["design_playbook", ["*"]],
        ["design_playbook", ["*"]],
      ])
    }),
  )
})

describe("Design agent permissions", () => {
  it.effect("keeps Design to its own tools and prototype directory, whatever the Session granted", () =>
    Effect.gen(function* () {
      const agent = yield* designAgent()
      const session: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]
      const effect = (action: string, resource: string) =>
        Permission.evaluate(action, resource, Permission.forAgent(agent as never, session)).effect

      expect(String(agent.name)).toBe("Design")
      expect(agent.mode).toBe("primary")
      expect(agent.system).toBeString()
      const tools = [
        "design_document",
        "design_preview",
        "design_read",
        "design_export",
        "design_history",
        "design_exit",
        "read",
        "grep",
        "todowrite",
        "question",
      ]
      expect(tools.filter((action) => effect(action, "*") !== "allow")).toEqual([])
      expect(effect("shell", "rm -rf /")).toBe("deny")
      expect(effect("write", "src/routes/checkout.tsx")).toBe("deny")
      expect(effect("edit", "src/routes/checkout.tsx")).toBe("deny")
      expect(effect("edit", ".red/code/design/design_tools/work/index.html")).toBe("allow")
      expect(effect("edit", "/worktrees/design-ses/.red/code/design/design_tools/work/index.html")).toBe("allow")
      expect(effect("external_directory", "/worktrees/design-ses/.red/code/design/design_tools/work/app.css")).toBe(
        "allow",
      )
      expect(effect("external_directory", "/etc/passwd")).toBe("ask")
      expect(effect("read", "apps/web/.env")).toBe("ask")
      expect(effect("read", "apps/web/.env.local")).toBe("ask")
      expect(effect("read", "apps/web/.env.example")).toBe("allow")
      expect(effect("project_tooling", "tailwind")).toBe("ask")
      expect(effect("subagent", "explore")).toBe("allow")
      expect(effect("subagent", "general")).toBe("deny")
    }),
  )
})

/** Runs the Design plugin against one editable agent, the way the agent domain applies plugin transforms. */
function designAgent() {
  return Effect.gen(function* () {
    const agent: Types.DeepMutable<Agent.Info> = {
      id: Agent.ID.make("design"),
      name: Agent.Name.make("design"),
      request: { settings: {}, headers: {}, body: {} },
      mode: "subagent",
      hidden: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }
    yield* DesignPlugin.Plugin.effect(
      host({
        agent: {
          get: () => Effect.die("unused agent.get"),
          list: () => Effect.die("unused agent.list"),
          reload: () => Effect.die("unused agent.reload"),
          transform: (callback) => {
            callback({
              list: () => [agent],
              get: (id) => (id === agent.id ? agent : undefined),
              default: () => {},
              update: (id, update) => {
                if (id === agent.id) update(agent)
              },
              remove: () => {},
            })
            return Effect.succeed({ dispose: Effect.void })
          },
        },
      }),
    )
    return agent
  })
}

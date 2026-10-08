import { describe, expect, test } from "bun:test"
import { Effect, Layer, type Types } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignChecklist } from "@opencode/core/design/checklist"
import { Monitor } from "@opencode/schema/monitor"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { DesignRenderer } from "@opencode/core/design/renderer"
import { DesignStore } from "@opencode/core/design/store"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { MonitorRuntime } from "@opencode/core/monitor"
import { Permission } from "@opencode/core/permission"
import { DesignPlugin } from "@opencode/core/plugin/design"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { DesignPlaybookTool } from "@opencode/core/tool/plugin/design-playbook"
import { DesignPreviewTool } from "@opencode/core/tool/plugin/design-preview"
import { DesignReadTool } from "@opencode/core/tool/plugin/design-read"
import { DesignRenderTool } from "@opencode/core/tool/plugin/design-render"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { it, testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"
import { host } from "./plugin/host"
import { tempLocationLayer } from "./fixture/location"

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
  brief: {
    objective: "Review subscription",
    audience: "Account owners",
    content: "Verified email and card",
    constraints: "Keep existing tokens",
    references: ["docs/profile.md"],
  },
  decisions: [{ id: "direction", text: "Keep the compact account layout" }],
  questions: [],
  scenarios: [],
  designSystem: { framework: "react", tokens: "src/tokens.css" },
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
const monitored: MonitorRuntime.Start[] = []
const jobs: Design.Job[] = []

const reset = () =>
  Effect.sync(() => {
    assertions.length = 0
    reads.length = 0
    started.length = 0
    monitored.length = 0
    jobs.splice(0, jobs.length, queued)
  })

const store = Layer.mock(DesignStore.Service, {
  storage: "/design/store",
  blobs: "/design/blobs",
  get: (_session, id) =>
    _session === sessionID && id === designID
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
  jobs: () => Effect.succeed(jobs),
})

const monitors = Layer.mock(MonitorRuntime.Service, {
  start: (input) =>
    Effect.sync(() => {
      monitored.push(input)
      return {
        id: "monitor_design",
        sessionID: input.sessionID,
        command: input.command,
        workdir: input.workdir,
        options: input.options,
        status: "running" as const,
        created: 1,
        updated: 1,
        attempts: 0,
        delivery: "pending" as const,
      }
    }),
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
  deps: [Tool.node, Permission.node, DesignStore.node, DesignRenderer.node, MonitorRuntime.node, Session.node],
})

const tools = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, designToolsNode]), [
    Location.node.replace(tempLocationLayer),
    Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })),
    Image.node.replace(imagePassthrough),
    DesignStore.node.replace(store),
    DesignRenderer.node.replace(renderer),
    MonitorRuntime.node.replace(monitors),
    Session.node.replace(
      Layer.mock(Session.Service, {
        context: () => Effect.succeed([]),
        revert: {
          stage: () => Effect.die("unused revert.stage"),
          clear: () => Effect.die("unused revert.clear"),
          commit: () => Effect.die("unused revert.commit"),
        },
      }),
    ),
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
      const agent = yield* designAgent()
      const snapshot = yield* registry.snapshot(Permission.forAgent(agent as never, []))
      const names = snapshot.definitions.map((tool) => tool.name)

      expect(names).toEqual(expect.arrayContaining(["design_read", "design_export", "design_jobs", "design_playbook"]))
      expect(names).not.toContain("execute")
      expect(yield* snapshot.execute({ ...call("design_read", { id: designID }), agent: agent.id })).toMatchObject({
        output: "Revision rev_one (not approved), section summary.",
        metadata: { designID },
      })
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

  tools.effect("reads review notes by round, feedback and note, and never a prototype file with them", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const one = { id: designID, section: "notes" as const, feedback: "msg_review", note: 3 }
      const round = { id: designID, section: "notes" as const, round: 2 }

      expect((yield* toolDefinitions(registry)).find((tool) => tool.name === "design_read")?.description).toContain(
        "Section notes lists every review note of the latest feedback round",
      )
      expect(yield* executeTool(registry, call("design_read", one))).toMatchObject({
        status: "completed",
        output: "Revision rev_one (not approved), section notes.",
        metadata: { designID },
      })
      expect((yield* executeTool(registry, call("design_read", round))).status).toBe("completed")
      expect(reads).toEqual([one, round])

      const file = yield* executeTool(registry, call("design_read", { ...round, file: "index.html" }))
      expect(file.status).toBe("error")
      // A note is named by its number in the message, not by a label.
      expect((yield* executeTool(registry, call("design_read", { ...one, note: "third" }))).status).toBe("error")
      expect(reads).toHaveLength(2)
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
      expect(monitored).toHaveLength(1)
      expect(monitored[0]).toMatchObject({
        sessionID,
        workdir: stored.root,
        options: { mode: "poll", success_contains: "[job_export:completed]", failure_contains: "[job_export:failed]" },
      })
      expect(assertions.map((item) => [item.action, item.resources])).toEqual([["design_export", [designID]]])

      const missing = yield* executeTool(
        registry,
        call("design_export", { id: Design.ID.make("design_other"), input: { revision: "rev_one", format: "pdf" } }),
      )
      expect(missing.status).toBe("error")
      expect(started).toHaveLength(1)
    }),
  )

  tools.effect("waits for the exact job and returns verification evidence when it completes", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const result = yield* executeTool(
        registry,
        call("design_export", { id: designID, input: { revision: "rev_one", format: "verify", round: 1 } }),
      )
      expect(result).toMatchObject({ status: "completed", metadata: { monitorID: "monitor_design" } })
      const monitor = monitored[0]!
      expect(monitor.command).toStartWith("Applying anti-slop verify:")
      const pending = yield* monitor.run(() => Effect.void)
      expect(Monitor.verdict(monitor.options, pending, undefined)).toBeUndefined()
      // An unrelated completed job must not release the Session's wait.
      jobs.push({ ...queued, id: "job_other", status: "completed" })
      expect(Monitor.verdict(monitor.options, yield* monitor.run(() => Effect.void), undefined)).toBeUndefined()
      jobs[0] = {
        ...queued,
        input: { revision: "rev_one", format: "verify", round: 1 },
        status: "completed",
        progress: 1,
        verify: {
          revision: "rev_one",
          round: 1,
          width: 1024,
          findings: [],
          notes: [
            {
              feedback: "msg_feedback",
              index: 0,
              label: "Profile",
              found: true,
              blocking: false,
              before: "/capture/before.png",
              after: "/capture/after.png",
              findings: [],
              scenarios: [],
              reason: "Updated profile found",
            },
          ],
        },
      }
      const completed = yield* monitor.run(() => Effect.void)
      expect(Monitor.verdict(monitor.options, completed, undefined)?.status).toBe("succeeded")
      expect(completed.output).toContain("Updated profile found")
      expect(completed.output).toContain("/capture/after.png")
      expect(completed.output).toContain('"job":"job_export"')
    }),
  )

  tools.effect("settles failed, cancelled, interrupted and missing jobs instead of polling forever", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      yield* executeTool(
        registry,
        call("design_export", { id: designID, input: { revision: "rev_one", format: "audit" } }),
      )
      const monitor = monitored[0]!
      for (const status of ["failed", "cancelled", "interrupted"] as const) {
        jobs[0] = { ...queued, status, error: "Renderer stopped" }
        const evidence = yield* monitor.run(() => Effect.void)
        expect(Monitor.verdict(monitor.options, evidence, undefined)?.status).toBe("failed")
        expect(evidence.output).toContain(status)
        expect(evidence.output).toContain("Renderer stopped")
      }
      jobs.length = 0
      expect(Monitor.verdict(monitor.options, yield* monitor.run(() => Effect.void), undefined)?.status).toBe("failed")
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

  tools.effect("reads only the contextual checklist without starting work or exposing another Session", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, call("design_playbook", { designID, checklist: true }))
      expect(result).toMatchObject({ status: "completed", metadata: { designID, checklist: true } })
      if (result.status !== "completed") throw new Error("Checklist failed")
      const text = String(result.output)
      for (const recorded of [
        "End-of-round checklist: screen",
        "Review subscription",
        "Account owners",
        "Verified email and card",
        "Keep existing tokens",
        "docs/profile.md",
        "Keep the compact account layout",
        "src/tokens.css",
        "rev_one",
      ])
        expect(text).toContain(recorded)
      expect(text).not.toContain("# Playbook:")
      expect(text).toContain("do not edit, republish or start another correction cycle")
      expect(text).toContain("For automatic end-of-round reviews")
      expect(text).toContain("An explicit browser Run anti-slop request authorizes one correction pass")
      expect(started).toEqual([])
      expect(monitored).toEqual([])
      expect(assertions[0]?.resources).toEqual([designID])
      const missing = yield* executeTool(registry, call("design_playbook", { checklist: true }))
      expect(missing.status).toBe("error")
      const foreign = yield* executeTool(registry, {
        ...call("design_playbook", { designID, checklist: true }),
        sessionID: Session.ID.make("ses_another_design"),
      })
      expect(foreign.status).toBe("error")
    }),
  )

  tools.effect("selects a component checklist explicitly and keeps full guidance available", () =>
    Effect.gen(function* () {
      yield* reset()
      const registry = yield* Tool.Service
      const result = yield* executeTool(
        registry,
        call("design_playbook", { id: "component", designID, checklist: true }),
      )
      expect(result).toMatchObject({ status: "completed" })
      if (result.status !== "completed") throw new Error("Checklist failed")
      expect(String(result.output)).toContain("End-of-round checklist: component")
      expect(String(result.output)).toContain("disabled, loading, error and long-content")
      const guidance = yield* executeTool(registry, call("design_playbook", { id: "component" }))
      expect(guidance).toMatchObject({ status: "completed", metadata: { playbook: "component" } })
    }),
  )
})

describe("Design checklist scope", () => {
  test("uses journey checks for mobile flows and narrative checks for presentations and older decks", () => {
    const flow = DesignChecklist.render({ ...stored, kind: "flow", target: "app", platform: "ios" })
    expect(flow).toContain("End-of-round checklist: flow")
    expect(flow).toContain("transitions, validation, completion, back navigation")
    expect(flow).toContain("touch targets, safe areas")
    const slides = DesignChecklist.render({ ...stored, target: "presentation" })
    expect(slides).toContain("End-of-round checklist: slides")
    expect(slides).toContain("speaker notes and presentation navigation")
    expect(slides).not.toContain("loading, empty, error, populated")
    expect(DesignChecklist.render({ ...stored, kind: "deck", target: undefined })).toContain(
      "End-of-round checklist: slides",
    )
  })
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
        "worktree_prepare",
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

describe("design_preview unchanged publishes", () => {
  test("only the prototype's own files decide whether a publish changed anything", () => {
    const files = { "index.html": "a".repeat(64), "app.css": "b".repeat(64) }
    expect(DesignPreviewTool.sameFiles({ files }, { files: { ...files } })).toBe(true)
    // Compiled output can differ between builds of the same source.
    expect(
      DesignPreviewTool.sameFiles(
        { files: { ...files, ".compiled/index.js": "c" } },
        { files: { ...files, ".compiled/index.js": "d" } },
      ),
    ).toBe(true)
    expect(DesignPreviewTool.sameFiles({ files }, { files: { ...files, "app.css": "e".repeat(64) } })).toBe(false)
    expect(DesignPreviewTool.sameFiles({ files }, { files: { ...files, "new.html": "f".repeat(64) } })).toBe(false)
  })
})

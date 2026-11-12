import { expect } from "bun:test"
import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Design } from "@opencode/schema/design"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { DesignStore } from "@opencode/core/design/store"
import { Intelligence } from "@opencode/core/intelligence"
import { Location } from "@opencode/core/location"
import { ModelsDev } from "@opencode/core/models-dev"
import { Form } from "@opencode/core/form"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { DesignCollaborationTool } from "@opencode/core/tool/plugin/design-collaboration"
import { DesignDocumentToolPlugin } from "@opencode/core/tool/plugin/design-document"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const gate = { allow: false, asked: [] as string[], wake: [] as string[] }
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      DesignStore.node,
      Session.node,
      SessionInbox.node,
      Location.node,
      Permission.node,
      SessionExecution.node,
      Form.node,
      Intelligence.node,
      SessionStore.node,
      Global.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Config.node.replace(Config.testLayer()),
      ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
      Intelligence.node.replace(
        Layer.mock(Intelligence.Service, {
          read: () => Effect.succeed({ enabled: false, onboarding: "completed", sessionReasoning: "single" }),
          evaluate: () => Effect.succeed(undefined),
        }),
      ),
      Permission.node.replace(
        permissionLayer({
          assert: (input) =>
            Effect.gen(function* () {
              gate.asked.push(input.action)
              if (input.action === "design_handoff" && !gate.allow)
                return yield* new Permission.BlockedError({
                  permission: input.action,
                  resources: input.resources,
                  rules: [],
                })
            }),
        }),
      ),
      SessionExecution.node.replace(
        Layer.mock(SessionExecution.Service, {
          wake: (id) =>
            Effect.sync(() => {
              gate.wake.push(id)
            }),
          active: Effect.succeed(new Set<Session.ID>()),
          isActive: () => Effect.succeed(false),
        }),
      ),
    ],
  ),
)

it.live(
  "handoff asks before mutation, switches the same real Session and admits one durable continuation across retries",
  () =>
    Effect.gen(function* () {
      gate.allow = false
      gate.asked = []
      gate.wake = []
      const location = yield* Location.Service
      const sessions = yield* Session.Service
      const designs = yield* DesignStore.Service
      const registry = yield* Tool.Service
      const inbox = yield* SessionInbox.Service
      const session = yield* sessions.create({
        title: "Cube",
        agent: Agent.ID.make("design"),
        location: { directory: location.directory },
      })
      const document = yield* designs.create(session.id, {
        name: "Cube editor",
        journey: "new",
        engine: "html",
        kind: "screen",
      })
      yield* registerToolPlugin(DesignCollaborationTool.Plugin)
      yield* registerToolPlugin(DesignDocumentToolPlugin.Plugin)
      const cached = yield* registry.snapshot()
      const call = (agent: "design" | "creator" | "build", input: unknown) =>
        executeTool(registry, {
          ...toolIdentity,
          sessionID: session.id,
          agent: Agent.ID.make(agent),
          call: { type: "tool-call", id: `call_${gate.asked.length}`, name: "design_collaboration", input },
        })
      const contract: Design.DeliveryContract = {
        kind: "interface",
        objective: "Accessible controls",
        acceptance: ["Works with keyboard"],
        states: ["ready", "error"],
      }
      expect((yield* call("build", { action: "define", id: document.id, expectedVersion: 0, contract })).status).toBe(
        "error",
      )
      expect((yield* call("design", { action: "define", id: document.id, expectedVersion: 0, contract })).status).toBe(
        "completed",
      )
      yield* Effect.promise(() =>
        Bun.write(path.join(document.root, document.entry), "<main>Interface for the cube</main>"),
      )
      const revision = yield* designs.publish(session.id, document.id, "Interface")
      const input = {
        action: "handoff",
        id: document.id,
        expectedVersion: 1,
        to: "creator",
        revision: revision.id,
        summary: "Implement the cube here",
        contract: {
          kind: "artifact",
          objective: "Working cube",
          artifact: "3d",
          acceptance: ["Material changes pixels"],
          outputs: ["preview"],
        },
      }
      expect((yield* call("design", input)).status).toBe("error")
      expect((yield* designs.get(session.id, document.id)).collaboration?.owner).toBe("design")
      expect((yield* sessions.get(session.id)).agent).toBe(Agent.ID.make("design"))
      expect(yield* inbox.list(session.id)).toHaveLength(0)
      gate.allow = true
      expect((yield* call("design", input)).status).toBe("completed")
      expect((yield* call("design", input)).status).toBe("completed")
      const assigned = yield* designs.get(session.id, document.id)
      expect(assigned).toMatchObject({
        id: document.id,
        root: document.root,
        revision: revision.id,
        approvedRevision: null,
        collaboration: { version: 2, owner: "creator", contracts: { design: contract } },
      })
      expect((yield* sessions.get(session.id)).agent).toBe(Agent.ID.make("creator"))
      const pending = yield* inbox.list(session.id)
      expect(pending).toHaveLength(1)
      expect(pending[0]?.sessionID).toBe(session.id)
      expect(JSON.stringify(pending[0])).toContain(document.id)
      expect(gate.asked).toContain("design_handoff")
      expect(gate.wake).toEqual([session.id, session.id])
      const wrongMode = yield* cached
        .execute({
          ...toolIdentity,
          sessionID: session.id,
          agent: Agent.ID.make("design"),
          call: {
            type: "tool-call",
            id: "call_stale_designer",
            name: "design_document",
            input: { action: "update", id: document.id, input: { name: "Wrong mode write" } },
          },
        })
        .pipe(Effect.flip)
      expect(wrongMode).toBeInstanceOf(Tool.Error)
      expect((yield* designs.get(session.id, document.id)).name).toBe("Cube editor")
      yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), "<main>Working cube</main>"))
      const artifact = yield* designs.publish(session.id, document.id, "Cube")
      expect(
        (yield* call("creator", {
          action: "handoff",
          id: document.id,
          expectedVersion: 2,
          to: "design",
          revision: artifact.id,
          summary: "Review the working cube and its controls",
        })).status,
      ).toBe("completed")
      expect((yield* sessions.get(session.id)).agent).toBe(Agent.ID.make("design"))
      expect((yield* designs.get(session.id, document.id)).collaboration).toMatchObject({
        version: 3,
        owner: "design",
        contracts: { design: contract },
      })
      expect(yield* inbox.list(session.id)).toHaveLength(2)
      expect(
        Schema.decodeUnknownOption(DesignCollaborationTool.Input)({ action: "handoff", id: document.id }),
      ).toMatchObject({ _tag: "None" })
    }),
  60_000,
)

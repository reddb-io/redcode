import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Form } from "@opencode/core/form"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionSchema } from "@opencode/core/session/schema"
import { Tool } from "@opencode/core/tool"
import { VaultRequestTool } from "@opencode/core/tool/plugin/vault-request"
import { Vault } from "@opencode/core/vault/vault"
import { Project } from "@opencode/schema/project"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Document, Info } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

// Assembled from parts so no secret scanner mistakes it for a real credential.
const typed = "hunter" + "-" + "correct-horse-battery"
const sessionID = Session.ID.make("ses_vault_request_tool_test")
const projectID = Project.ID.make("prj_vault_request")
let asked: Form.CreateInput | undefined
let answer: Form.TerminalState = { status: "cancelled" }
let deny = false

const form = Layer.mock(Form.Service, {
  ask: (input: Form.CreateInput) =>
    Effect.sync(() => {
      asked = input
      return answer
    }),
})
const toolNode = makeLocationNode({
  name: "test/vault-request-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(VaultRequestTool.Plugin)),
  deps: [Tool.node, Permission.node, Form.node, Config.node],
})

const configLayer = Config.testLayer()
const it = testEffect(
  Layer.merge(
    configLayer,
    AppNodeBuilder.build(LayerNode.group([Tool.node, toolNode]), [
      Permission.node.replace(
        permissionLayer({
          assert: (input) =>
            deny
              ? Effect.fail(
                  new Permission.BlockedError({ rules: [], permission: input.action, resources: [...input.resources] }),
                )
              : Effect.void,
        }),
      ),
      Form.node.replace(form),
      Config.node.replace(configLayer),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) }))),
      ),
      Image.node.replace(imagePassthrough),
    ]),
  ),
)

const call = (id: string, name = "Stripe Key") => ({
  sessionID,
  ...toolIdentity,
  call: {
    type: "tool-call" as const,
    id,
    name: VaultRequestTool.name,
    input: { name, purpose: "Create a test payment" },
  },
})

describe("VaultRequestTool", () => {
  it.effect("stores what the user typed and returns only its reference", () =>
    Effect.gen(function* () {
      const vault = Vault.make()
      answer = { status: "answered", answer: { value: typed } }
      const registry = yield* Tool.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain(VaultRequestTool.name)
      const settled = yield* executeTool(registry, call("call-vault-request")).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
      )
      expect(settled).toEqual({
        status: "completed",
        output: { name: "stripe-key", declined: false },
        content: [
          {
            type: "text",
            text: "The user stored the secret as {vault:stripe-key}. Use that reference where the value belongs; you never see the value.",
          },
        ],
        metadata: { name: "stripe-key", declined: false },
      })
      expect(asked).toMatchObject({
        sessionID,
        metadata: { kind: "vault", secret: true, name: "stripe-key", purpose: "Create a test payment" },
        fields: [{ key: "value", type: "string", required: true }],
      })
      expect(yield* vault.resolve({ projectID, name: "stripe-key" })).toBe(typed)
      expect(JSON.stringify([settled, asked])).not.toContain(typed)
    }),
  )

  it.effect("stops execution on a decline instead of returning a successful result", () =>
    Effect.gen(function* () {
      const vault = Vault.make()
      answer = { status: "cancelled" }
      const registry = yield* Tool.Service
      const settled = yield* Effect.exit(
        executeTool(registry, call("call-vault-decline")).pipe(
          Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
        ),
      )
      expect(Exit.isFailure(settled)).toBe(true)
      if (Exit.isFailure(settled)) expect(Cause.squash(settled.cause)).toBeInstanceOf(VaultRequestTool.CancelledError)
      expect(yield* vault.list(projectID)).toEqual([])
    }),
  )

  it.effect("reads an empty or non-text answer as a decline and stores nothing", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const answers: ReadonlyArray<Form.TerminalState> = [
        { status: "answered", answer: { value: "" } },
        { status: "answered", answer: { value: 42 } },
        { status: "answered", answer: { value: [typed] } },
        { status: "answered", answer: {} },
      ]
      const settled = yield* Effect.forEach(answers, (item, index) =>
        Effect.gen(function* () {
          const vault = Vault.make()
          answer = item
          const result = yield* Effect.exit(
            executeTool(registry, call(`call-vault-empty-${index}`)).pipe(
              Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
            ),
          )
          expect(yield* vault.list(projectID)).toEqual([])
          return result
        }),
      )
      expect(settled.every(Exit.isFailure)).toBe(true)
      settled.forEach((item) => {
        if (Exit.isFailure(item)) expect(Cause.squash(item.cause)).toBeInstanceOf(VaultRequestTool.CancelledError)
      })
      // An array answer carrying the typed text is refused whole, and never echoed back.
      expect(JSON.stringify(settled)).not.toContain(typed)
    }),
  )

  it.effect("asks under a generic name when the requested one has nothing usable", () =>
    Effect.gen(function* () {
      const vault = Vault.make()
      answer = { status: "answered", answer: { value: typed } }
      const registry = yield* Tool.Service
      const settled = yield* executeTool(registry, call("call-vault-unusable", "!!!")).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
      )
      expect(asked?.title).toBe("Secret requested: {vault:secret}")
      expect(settled).toMatchObject({ status: "completed", output: { name: "secret", declined: false } })
      expect(yield* vault.resolve({ projectID, name: "secret" })).toBe(typed)
    }),
  )

  it.effect("never replaces a secret the user stored under the requested name", () =>
    Effect.gen(function* () {
      const vault = Vault.make()
      const own = "user" + "-" + "owned-value-1234"
      yield* vault.set({ projectID, name: "stripe-key", value: own, origin: "user" })
      answer = { status: "answered", answer: { value: typed } }
      const registry = yield* Tool.Service
      const settled = yield* executeTool(registry, call("call-vault-held")).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
      )
      expect(settled).toMatchObject({ status: "completed", output: { name: "stripe-key-1", declined: false } })
      expect(yield* vault.resolve({ projectID, name: "stripe-key" })).toBe(own)
      expect(yield* vault.resolve({ projectID, name: "stripe-key-1" })).toBe(typed)
      // The same value typed again under the held name keeps the name it already has.
      answer = { status: "answered", answer: { value: own } }
      const again = yield* executeTool(registry, call("call-vault-same")).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
      )
      expect(again).toMatchObject({ status: "completed", output: { name: "stripe-key", declined: false } })
      expect(JSON.stringify([settled, again])).not.toContain(own)
      expect(JSON.stringify([settled, again])).not.toContain(typed)
    }),
  )

  it.effect("fails outside a Session's tool execution without asking", () =>
    Effect.gen(function* () {
      asked = undefined
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call("call-vault-unbound"))).toEqual({
        status: "error",
        error: { type: "tool.execution", message: "The vault is not available outside a session." },
      })
      expect(asked).toBeUndefined()
    }),
  )

  it.effect("stops at a denied question permission before the form opens", () =>
    Effect.gen(function* () {
      const vault = Vault.make()
      asked = undefined
      deny = true
      answer = { status: "answered", answer: { value: typed } }
      const registry = yield* Tool.Service
      const settled = yield* executeTool(registry, call("call-vault-denied")).pipe(
        Effect.provideService(Vault.Current, Vault.bind(vault, projectID)),
      )
      expect(settled).toEqual({
        status: "error",
        error: { type: "permission.rejected", message: "Permission denied: question" },
      })
      expect(asked).toBeUndefined()
      expect(yield* vault.list(projectID)).toEqual([])
    }).pipe(Effect.ensuring(Effect.sync(() => (deny = false)))),
  )

  it.effect("blocks an already captured executor when configuration disables vault", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      const config = yield* Config.Test
      yield* config.setEntries([new Document({ type: "document", info: new Info({ vault: false }) })])
      asked = undefined
      const result = yield* snapshot.execute(call("call-disabled")).pipe(Effect.flip)
      expect(result.message).toBe("Vault is disabled for this repository.")
      expect(asked).toBeUndefined()
      // A repository choice takes precedence over a global setting.
      yield* config.setEntries([
        new Document({ type: "document", info: new Info({ vault: false }) }),
        new Document({ type: "document", info: new Info({ vault: true }) }),
      ])
      answer = { status: "answered", answer: { value: typed } }
      const vault = Vault.make()
      expect(
        (yield* snapshot
          .execute(call("call-enabled"))
          .pipe(Effect.provideService(Vault.Current, Vault.bind(vault, projectID)))).output,
      ).toEqual({ name: "stripe-key", declined: false })
    }),
  )

  it.effect("hides the tool from an agent that may not ask questions", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const names = (yield* toolDefinitions(registry, [{ action: "question", resource: "*", effect: "deny" }])).map(
        (tool) => tool.name,
      )
      expect(names).not.toContain(VaultRequestTool.name)
    }),
  )
})

describe("Form secrecy", () => {
  const forms = testEffect(AppNodeBuilder.build(LayerNode.group([Bus.node, Form.node])))

  forms.effect("hands a secret answer to the asker only, never to events or the kept state", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const events: unknown[] = []
      const created = yield* Deferred.make<Form.Info>()
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          events.push(event)
          if (event.type === Form.Event.Created.type)
            yield* Deferred.succeed(created, (event.data as { readonly form: Form.Info }).form)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service
        .ask({
          sessionID: SessionSchema.ID.make("ses_vault_form"),
          title: "Secret requested",
          metadata: { kind: "vault", secret: true, name: "stripe-key", purpose: "test" },
          fields: [{ key: "value", type: "string", required: true }],
        })
        .pipe(Effect.forkScoped)
      const info = yield* Deferred.await(created)
      yield* service.reply({ id: info.id, answer: { value: typed } })
      expect(yield* Fiber.join(fiber)).toEqual({ status: "answered", answer: { value: typed } })
      expect(yield* service.state(info.id)).toEqual({ status: "answered", answer: {} })
      expect(JSON.stringify(events)).not.toContain(typed)
      expect(events.length).toBeGreaterThan(1)
    }),
  )
})

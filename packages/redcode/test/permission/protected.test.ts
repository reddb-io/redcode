import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpProtected } from "../../src/mcp/protected"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
    [[InstanceStore.bootstrapNode, noopBootstrap]],
  ),
)

const sessionID = SessionID.make("session_protected")

/** Runs `body` as if redcode were started with --yolo. */
const yolo = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = process.env.REDCODE_YOLO
      process.env.REDCODE_YOLO = "1"
      return before
    }),
    () => body,
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env.REDCODE_YOLO
        else process.env.REDCODE_YOLO = before
      }),
  )

const pending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    while (true) {
      const list = yield* permission.list()
      if (list.length === count) return list
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeout("1 second"))

const request = (id: string, extra: Partial<PermissionV1.AskInput> = {}): PermissionV1.AskInput => ({
  id: PermissionV1.ID.make(id),
  sessionID,
  permission: "red-router_create_api_key",
  patterns: ["*"],
  metadata: { protected: "Creates a RedRouter API key" },
  always: ["*"],
  ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
  protected: true,
  ...extra,
})

it.instance(
  "yolo and allow rules skip ordinary asks but never a protected one",
  () =>
    yolo(
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        // An ordinary call goes through without a prompt.
        yield* permission.ask(request("per_plain", { protected: undefined, permission: "red-router_list_models" }))
        expect(yield* permission.list()).toEqual([])

        const asked = yield* permission.ask(request("per_protected_a")).pipe(Effect.forkScoped)
        const [shown] = yield* pending(1)
        expect(shown?.protected).toBe(true)
        // Only "once" applies: it is never approved for later.
        expect(shown?.always).toEqual([])
        yield* permission.reply({ requestID: PermissionV1.ID.make("per_protected_a"), reply: "always" })
        yield* Fiber.join(asked)

        // Asked again the next time, whatever was answered before.
        const again = yield* permission.ask(request("per_protected_b")).pipe(Effect.forkScoped)
        yield* pending(1)
        yield* permission.reply({ requestID: PermissionV1.ID.make("per_protected_b"), reply: "once" })
        yield* Fiber.join(again)
        expect(yield* permission.list()).toEqual([])
      }),
    ),
  { git: true },
)

it.instance(
  "a configured deny still refuses a protected action",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const exit = yield* permission
        .ask(request("per_denied", { ruleset: [{ permission: "red-router_*", pattern: "*", action: "deny" }] }))
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
)

test("RedRouter key management over MCP is protected; the key's own reads are not", () => {
  const reason = (tool: string, args: unknown = {}, server = "red-router") =>
    McpProtected.reason({ server, tool, args })
  expect(reason("create_api_key")).toBeString()
  expect(reason("list_api_keys")).toBeString()
  expect(reason("get_usage", { api_key_id: "key_other" })).toBeString()
  expect(reason("get_usage", { hours: 24 })).toBeUndefined()
  expect(reason("get_api_key")).toBeUndefined()
  expect(reason("recommend_models")).toBeUndefined()
  // Another server's tool of the same name is none of RedRouter's business.
  expect(reason("create_api_key", {}, "other")).toBeUndefined()
})

test("a protected MCP call asks once, marked protected", () => {
  const client = new Client({ name: "test", version: "1" })
  const router = Object.assign(client, { getServerVersion: () => ({ name: "red-router", version: "0.29.0" }) })
  expect(McpProtected.ask("red-router_create_api_key", { def: { name: "create_api_key" }, client: router }, {})).toEqual({
    permission: "red-router_create_api_key",
    metadata: { protected: "Creates a RedRouter API key" },
    patterns: ["*"],
    always: [],
    protected: true,
  })
  expect(McpProtected.ask("red-router_list_models", { def: { name: "list_models" }, client: router }, {})).toEqual({
    permission: "red-router_list_models",
    metadata: {},
    patterns: ["*"],
    always: ["*"],
  })
})

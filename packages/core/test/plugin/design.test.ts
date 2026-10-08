import { expect } from "bun:test"
import { Deferred, Effect, Layer, PubSub, Stream, type Types } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { DesignPlugin } from "@opencode/core/plugin/design"
import { Event } from "@opencode/schema/event"
import { McpEvent } from "@opencode/schema/mcp-event"
import { it } from "../lib/effect"
import { host } from "./host"

it.effect("refreshes Design permissions when an MCP connects after agent initialization", () =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<Event.Payload>()
    const tools = yield* PubSub.subscribe(events)
    const status = yield* PubSub.subscribe(events)
    const refreshed = yield* Deferred.make<void>()
    const state = { tools: [] as Mcp.Tool[], apply: () => {} }
    const agent: Types.DeepMutable<Agent.Info> = {
      id: Agent.ID.make("design"),
      name: Agent.Name.make("design"),
      request: { settings: {}, headers: {}, body: {} },
      mode: "primary",
      hidden: false,
      permissions: [],
    }
    yield* Effect.gen(function* () {
      yield* DesignPlugin.Plugin.effect(
        host({
          agent: {
            get: () => Effect.die("unused agent.get"),
            list: () => Effect.die("unused agent.list"),
            reload: () => Effect.sync(state.apply).pipe(Effect.andThen(Deferred.succeed(refreshed, undefined))),
            transform: (callback) => {
              state.apply = () => {
                // The real Agent domain replays transforms from its configured base on each reload.
                agent.permissions = []
                callback({
                  list: () => [agent],
                  get: () => agent,
                  default: () => {},
                  remove: () => {},
                  update: (_id, update) => update(agent),
                })
              }
              state.apply()
              return Effect.succeed({ dispose: Effect.void })
            },
          },
        }),
      )
      expect(Permission.evaluate("vela_lookup", "*", agent.permissions).effect).toBe("deny")
      state.tools = [{ server: Mcp.ServerName.make("vela"), name: "lookup", inputSchema: { type: "object" } }]
      yield* PubSub.publish(events, {
        id: Event.ID.create(),
        type: McpEvent.StatusChanged.type,
        created: Date.now(),
        data: { server: "vela" },
      })
      yield* Deferred.await(refreshed)
      expect(Permission.evaluate("vela_lookup", "*", agent.permissions).effect).toBe("ask")
      expect(Permission.evaluate("shell", "*", agent.permissions).effect).toBe("deny")
      expect(Permission.evaluate("edit", "src/app.tsx", agent.permissions).effect).toBe("deny")
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(Mcp.Service, { tools: () => Effect.succeed(state.tools) }),
          Layer.mock(Bus.Service, {
            subscribe: ((definition: Event.Definition) =>
              Stream.fromSubscription(definition.type === McpEvent.ToolsChanged.type ? tools : status).pipe(
                Stream.filter((event) => event.type === definition.type),
              )) as Bus.Subscribe,
          }),
        ),
      ),
    )
  }),
)

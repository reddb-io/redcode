export * as DesignStudio from "./studio"

import path from "node:path"
import { Context, Effect, Layer, Semaphore } from "effect"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { Database } from "@reddb-io/redcode-core/database/database"
import { Location } from "@reddb-io/redcode-core/location"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"

export class Service extends Context.Service<
  Service,
  {
    readonly handoff: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    readonly use: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, Exclude<R, DesignStore.Service | DesignRenderer.Service>>
    readonly assertSession: (
      sessionID: SessionID,
    ) => Effect.Effect<Session.Info, import("@/storage/storage").NotFoundError>
  }
>()("@redcode/DesignStudio") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sessions = yield* Session.Service
    // Share the Design domain, not SessionV2 execution. The TUI owns its existing conversation.
    const state = yield* InstanceState.make((instance) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          AppNodeBuilderV1.build(LayerNode.group([DesignStore.node, DesignRenderer.node]), [
            [Database.node, Layer.succeed(Database.Service, database)],
            [
              Location.node,
              Layer.succeed(Location.Service, {
                directory: AbsolutePath.make(instance.directory),
                project: { id: instance.project.id, directory: AbsolutePath.make(instance.worktree) },
              }),
            ],
          ]),
        )
        return {
          handoff: yield* Semaphore.make(1),
          store: Context.get(context, DesignStore.Service),
          renderer: Context.get(context, DesignRenderer.Service),
        }
      }),
    )
    return {
      handoff: Effect.fn("DesignStudio.handoff")(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
        const current = yield* InstanceState.get(state)
        return yield* effect.pipe(current.handoff.withPermits(1))
      }),
      use: Effect.fn("DesignStudio.use")(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
        const current = yield* InstanceState.get(state)
        return yield* effect.pipe(
          Effect.provide(
            Context.make(DesignStore.Service, current.store).pipe(
              Context.add(DesignRenderer.Service, current.renderer),
            ),
          ),
        )
      }),
      assertSession: Effect.fn("DesignStudio.assertSession")(function* (sessionID: SessionID) {
        const session = yield* sessions.get(sessionID)
        const instance = yield* InstanceState.context
        if (path.resolve(session.directory) !== path.resolve(instance.directory))
          return yield* Effect.die(new Error("Design session belongs to another directory"))
        return session
      }),
    }
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node, Session.node] })

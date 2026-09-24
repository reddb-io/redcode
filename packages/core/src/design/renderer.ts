export * as DesignRenderer from "./renderer"

import { Context, Effect, Layer } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { makeLocationNode } from "../effect/app-node"
import { AppProcess } from "../process"
import { Config } from "../config"
import { DesignStore } from "./store"
import { DesignApp } from "./app"
import type { DesignRendererLocal } from "./renderer-local"

/** Renders, exports and audits a Design's revisions as jobs, and builds the directory a preview serves. */
export type Interface = DesignRendererLocal.Interface
export class Service extends Context.Service<Service, Interface>()("@redcode/DesignRenderer") {}

/**
 * The renderer of a compiled redcode, which links none of the rendering code: jobs run in the design
 * app, which records them in the shared database, and previews are its to build and serve.
 */
const remote = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* DesignStore.Service
    const config = yield* Config.Service
    const connect = Effect.gen(function* () {
      const version = (yield* config.entries())
        .flatMap((entry) =>
          entry.type === "document" && entry.info.design?.app?.version ? [entry.info.design.app.version] : [],
        )
        .at(-1)
      return yield* DesignApp.connect({ version })
    })
    return Service.of({
      start: (id, input) =>
        Effect.gen(function* () {
          const document = yield* store.get(id)
          return yield* DesignApp.render(yield* connect, document.sessionID, id, input)
        }),
      cancel: (id, jobID) =>
        Effect.gen(function* () {
          const document = yield* store.get(id)
          return yield* DesignApp.cancel(yield* connect, document.sessionID, id, jobID)
        }),
      jobs: (id) =>
        Effect.gen(function* () {
          const document = yield* store.get(id)
          const running = yield* Effect.promise(() => DesignApp.running())
          if (running) return [...(yield* DesignApp.jobs(running, document.sessionID, id))]
          // No app runs, so no job does: one still marked running was interrupted with the app that ran it.
          return yield* Effect.forEach(yield* store.jobs(id), (job) =>
            job.status === "running" || job.status === "queued"
              ? store.putJob({ ...job, status: "interrupted", finished: Date.now() })
              : Effect.succeed(job),
          )
        }),
      directory: () =>
        Effect.fail(
          new Design.Error({ code: "unavailable", message: "Previews are built and served by the design app" }),
        ),
    })
  }),
)

/**
 * Compiled redcode defines REDCODE_DESIGN_APP_ONLY, so its bundler drops the local renderer and all it
 * links (exports, rasters, the page runtime): Design's heavy work runs in the design app. A source
 * checkout keeps it, for Design inline and for tests.
 */
function implementation(): Effect.Effect<
  Layer.Layer<Service, never, DesignStore.Service | AppProcess.Service | Config.Service>
> {
  return process.env.REDCODE_DESIGN_APP_ONLY === "1"
    ? Effect.succeed(remote)
    : Effect.promise(async () => {
        const { DesignRendererLocal } = await import("./renderer-local")
        return DesignRendererLocal.layer
      })
}

export const node = makeLocationNode({
  service: Service,
  layer: Layer.unwrap(Effect.suspend(implementation)),
  deps: [DesignStore.node, AppProcess.node, Config.node],
})

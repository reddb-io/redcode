export * as DesignRenderer from "./renderer.js"

import { Context, Effect, Layer, Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { AppProcess } from "@opencode/util/process"
import type { DesignApp } from "./app.js"
import { DesignAppConnection } from "./app-connection.js"
import { DesignAppMode } from "./app-mode.js"
import { DesignStore } from "./store.js"
import type { DesignRendererLocal } from "./renderer-local.js"

/** Renders, exports and audits Design revisions and prepares preview directories. */
export type Interface = DesignRendererLocal.Interface
export class Service extends Context.Service<Service, Interface>()("@redcode/DesignRenderer") {}

const make = Effect.gen(function* () {
  const store = yield* DesignStore.Service
  const apps = yield* DesignAppConnection.Service
  const { DesignRendererLocal } = yield* Effect.promise(() => import("./renderer-local.js"))
  const local = yield* DesignRendererLocal.make
  const connection = (sessionID: Design.Info["sessionID"]) =>
    Effect.gen(function* () {
      const configured = yield* store.configured(sessionID)
      if (!DesignAppMode.process(configured)) return
      return yield* Effect.tryPromise({
        try: () => apps.connect(configured?.app?.version),
        catch: (error) =>
          new Design.Error({
            code: "unavailable",
            message: `The design app did not start: ${error instanceof Error ? error.message : String(error)}`,
          }),
      })
    })
  const call = <A>(
    app: DesignApp.Connection,
    sessionID: Design.Info["sessionID"],
    route: string,
    schema: Schema.Codec<A, unknown, never, never>,
    input?: unknown,
  ) =>
    Effect.tryPromise({
      try: async (signal) => {
        const { DesignApp } = await import("./app.js")
        return DesignApp.call(app, sessionID, route, schema, input, signal)
      },
      catch: (error) =>
        error instanceof Design.Error
          ? error
          : new Design.Error({
              code: "unavailable",
              message: `The design app did not answer: ${error instanceof Error ? error.message : String(error)}`,
            }),
    })
  const start: Interface["start"] = (sessionID, id, input) =>
    Effect.gen(function* () {
      const app = yield* connection(sessionID)
      if (!app) return yield* local.start(sessionID, id, input)
      return yield* call(app, sessionID, `/${encodeURIComponent(id)}/job`, Design.Job, input)
    })
  const cancel: Interface["cancel"] = (sessionID, id, jobID) =>
    Effect.gen(function* () {
      const app = yield* connection(sessionID)
      if (!app) return yield* local.cancel(sessionID, id, jobID)
      return yield* call(app, sessionID, `/${encodeURIComponent(id)}/job/${encodeURIComponent(jobID)}/cancel`, Design.Job, {})
    })
  const jobs: Interface["jobs"] = (sessionID, id) =>
    Effect.gen(function* () {
      const app = yield* connection(sessionID)
      if (!app) return yield* local.jobs(sessionID, id)
      return [...(yield* call(app, sessionID, `/${encodeURIComponent(id)}/job`, Schema.Array(Design.Job)))]
    })
  const directory: Interface["directory"] = (revision) =>
    Effect.gen(function* () {
      const app = yield* connection(revision.document.sessionID)
      if (!app) return yield* local.directory(revision)
      const result = yield* call(
        app,
        revision.document.sessionID,
        `/${encodeURIComponent(revision.designID)}/revision/${encodeURIComponent(revision.id)}/directory`,
        Schema.Struct({ path: Schema.String }),
      )
      return result.path
    })
  return { start, cancel, jobs, directory }
})

export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [DesignStore.node, AppProcess.node, DesignAppConnection.node],
})

export * as DesignDetection from "./detection.js"

import path from "node:path"
import { Design } from "@opencode/schema/design"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { Location } from "../location.js"
import { DesignProposal } from "./proposal.js"

/** Static detection and its evidence pack, without changing project files or adoption state. */
export const report = Effect.fn("DesignDetection.report")(function* (input: { application?: string; pack?: boolean }) {
  const location = yield* Location.Service
  const global = yield* Global.Service
  return yield* Effect.tryPromise({
    try: () =>
      DesignProposal.detection({
        directory: location.directory,
        application: input.application,
        global: global.config,
        state: path.join(global.state, DesignProposal.STATE),
        pack: input.pack,
      }),
    catch: () => new Design.Error({ code: "unavailable", message: "Unable to inspect the Design system" }),
  })
})

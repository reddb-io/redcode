export * as DesignBrowserPermissions from "./design-browser-permissions"

import path from "node:path"
import { realpath, stat } from "node:fs/promises"
import type { Agent } from "@opencode/schema/agent"
import { DesignBuild } from "@opencode/core/design/build"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { SessionSchema } from "@opencode/core/session/schema"
import type { Design } from "@opencode/schema/design"
import { Cause, Effect } from "effect"

/** Authorize each file a Design build imports through the owning Session's permission queue. */
export const reader = Effect.fn("DesignBrowserPermissions.reader")(function* (
  sessionID: SessionSchema.ID,
  agent: Agent.ID | undefined,
  origin = "design.browser",
) {
  const access = yield* FileAccess.Service
  const permission = yield* Permission.Service
  const read: DesignBuild.Read = (file, signal) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const canonical = yield* Effect.promise(() => realpath(file))
        const target = yield* access.resolve({ path: canonical, kind: "file" })
        if (target.externalDirectory)
          yield* permission.assert({
            ...FileAccess.externalDirectoryPermission(target.externalDirectory),
            sessionID,
            agent,
            metadata: { origin, path: canonical },
          })
        yield* permission.assert({
          action: "read",
          resources: [target.resource],
          save: [target.resource],
          sessionID,
          agent,
          metadata: { origin, path: canonical },
        })
      }),
      { signal },
    )
  return read
})

/** Project tooling runs only after the Session grants the named configuration files. */
export const tooling = Effect.fn("DesignBrowserPermissions.tooling")(function* (
  sessionID: SessionSchema.ID,
  agent: Agent.ID | undefined,
  document: Design.Info,
  origin = "design.browser",
) {
  const access = yield* FileAccess.Service
  const permission = yield* Permission.Service
  const files = yield* Effect.promise(() => DesignBuild.tooling(document))
  if (!files.length) return false
  const resources = yield* Effect.forEach(files, (file) =>
    Effect.all({
      target: access.resolve({ path: file, kind: "directory" }),
      directory: Effect.promise(() => stat(file).then((info) => info.isDirectory())),
    }).pipe(Effect.map((item) => (item.directory ? `${item.target.resource}/*` : item.target.resource))),
  )
  return yield* permission
    .assert({
      action: "project_tooling",
      resources,
      save: resources,
      sessionID,
      agent,
      metadata: {
        origin,
        reason: `Execute project tooling: ${files.map((file) => path.basename(file)).join(", ")}`,
      },
    })
    .pipe(
      Effect.as(true),
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause)
        return error instanceof Permission.DeclinedError ||
          error instanceof Permission.CorrectedError ||
          error instanceof Permission.BlockedError
          ? Effect.succeed(false)
          : Effect.failCause(cause)
      }),
    )
})

/** Browser publication asks through the same Session permission queue as Design tools. */
export const grants = Effect.fn("DesignBrowserPermissions.grants")(function* (
  sessionID: SessionSchema.ID,
  agent: Agent.ID | undefined,
  document: Design.Info,
) {
  const read = yield* reader(sessionID, agent)
  return { read, tooling: yield* tooling(sessionID, agent, document) }
})

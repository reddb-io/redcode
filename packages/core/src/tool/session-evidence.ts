export * as SessionEvidence from "./session-evidence"

import path from "node:path"
import { realpath, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import { ToolFailure } from "@reddb-io/redcode-llm"
import { PermissionV2 } from "../permission"
import { Location } from "../location"
import { Tool } from "./tool"

export const hash = (content: Uint8Array | string) => createHash("sha256").update(content).digest("hex")

export const read = Effect.fn("SessionEvidence.read")(function* (
  file: string,
  context: Tool.Context,
  permissions: PermissionV2.Interface,
  location: Location.Ref,
) {
  const target = yield* Effect.tryPromise({
    try: () => realpath(path.resolve(location.directory, file)),
    catch: () => new ToolFailure({ message: `Evidence file not found: ${file}` }),
  })
  const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
  if (target !== location.directory && !target.startsWith(location.directory + path.sep))
    yield* permissions.assert({
      action: "external_directory",
      resources: [path.dirname(target)],
      save: [path.dirname(target)],
      sessionID: context.sessionID,
      agent: context.agent,
      source,
    })
  yield* permissions.assert({
    action: "read",
    resources: [target],
    save: [target],
    sessionID: context.sessionID,
    agent: context.agent,
    source,
  })
  return yield* Effect.tryPromise({
    try: async () => {
      const info = await stat(target)
      if (!info.isFile() || info.size > 128000)
        throw new Error(
          "Evidence must be a regular file of at most 128 KB; provide a focused report for larger artifacts",
        )
      const content = await Bun.file(target).text()
      if (!content.trim()) throw new Error("Evidence file is empty")
      if (Buffer.byteLength(content) > 128000 || content.includes("\0"))
        throw new Error("Provide a focused text report of at most 128 KB for this artifact")
      return { path: target, hash: hash(content), bytes: Buffer.byteLength(content), content }
    },
    catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
  })
})

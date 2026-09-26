export * as SessionEvidence from "./session-evidence.js"

import { createHash } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { ToolFailure } from "@opencode/ai"
import { Effect } from "effect"
import { FileAccess } from "../file-access.js"
import type { Tool } from "../tool.js"

export const hash = (content: Uint8Array | string) => createHash("sha256").update(content).digest("hex")

export const read = Effect.fn("SessionEvidence.read")(function* (
  file: string,
  context: Tool.Context,
  access: FileAccess.Interface,
) {
  const requested = yield* access.authorizeRead(file, context)
  const target = yield* Effect.tryPromise({
    try: () => realpath(requested.absolute),
    catch: () => new ToolFailure({ message: `Evidence file not found: ${file}` }),
  })
  if (target !== requested.absolute) yield* access.authorizeRead(target, context)
  return yield* Effect.tryPromise({
    try: async () => {
      const info = await stat(target)
      if (!info.isFile() || info.size > 128_000)
        throw new Error("Evidence must be a regular file of at most 128 KB")
      const content = await Bun.file(target).text()
      if (!content.trim()) throw new Error("Evidence file is empty")
      const bytes = Buffer.byteLength(content)
      if (bytes > 128_000 || content.includes("\0"))
        throw new Error("Provide a focused text report of at most 128 KB for this artifact")
      return { path: target, hash: hash(content), bytes, content }
    },
    catch: (cause) =>
      new ToolFailure({ message: cause instanceof Error ? cause.message : "Unable to read evidence file" }),
  })
})

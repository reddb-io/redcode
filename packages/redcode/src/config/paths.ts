export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@reddb-io/redcode-core/flag/flag"
import { Global } from "@reddb-io/redcode-core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"

// `names` is ordered from highest to lowest precedence; the reversal at the end turns the
// whole walk into lowest-to-highest so callers can merge it front to back.
export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  names: string[],
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: names.flatMap((name) => [`${name}.jsonc`, `${name}.json`]),
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.REDCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".opencode", ".redcode"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".opencode", ".redcode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.REDCODE_CONFIG_DIR ? [Flag.REDCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

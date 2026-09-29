export * as ConfigWorktreePlugin from "./worktree.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { Config } from "../../config.js"
import { Global } from "@opencode/util/global"
import { Location } from "../../location.js"
import { AbsolutePath } from "../../schema.js"
import { WorktreePlacement } from "../../worktree/placement.js"
import { WorktreeStrategies } from "../../worktree/strategies.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.worktree",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const worktrees = yield* WorktreeStrategies.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, worktrees.reload())
    yield* worktrees.transform((editor) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document" || !entry.info.worktree) continue
        const directory = entry.info.worktree.directory
        if (!directory) continue
        editor.configure({
          directory: AbsolutePath.make(
            directory.startsWith("~/")
              ? path.join(global.home, directory.slice(2))
              : path.resolve(location.project.canonical, directory),
          ),
        })
      }
      // A temporary location wins over `worktree.directory`, as it does for Session worktrees. Without a
      // Session, the server's own environment (`--tmp`, `REDCODE_WORKTREE_LOCATION`) applies.
      const settings = Config.latest(loaded.entries, "worktree")
      if (WorktreePlacement.location(settings, process.env) !== "tmp") return
      editor.configure({
        directory: AbsolutePath.make(
          WorktreePlacement.temporaryParent(location.project.canonical, settings?.tmpdir || os.tmpdir()),
        ),
      })
    })
  }),
})

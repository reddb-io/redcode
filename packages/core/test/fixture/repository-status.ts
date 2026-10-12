import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { AbsolutePath } from "@opencode/core/schema"
import { initRepo } from "./git"
import { tmpdirScoped } from "./tmpdir"

export const repositoryStatusFixture = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  const main = AbsolutePath.make(path.join(root.path, "main"))
  const linked = AbsolutePath.make(path.join(root.path, "linked"))
  yield* Effect.promise(async () => {
    await fs.mkdir(main)
    await initRepo(main)
    await $`git branch -M main`.cwd(main).quiet()
    await fs.writeFile(path.join(main, "tracked.txt"), "baseline\n")
    await fs.writeFile(path.join(main, "other.txt"), "other\n")
    await fs.writeFile(path.join(main, ".gitignore"), "ignored.tmp\n")
    await $`git add .`.cwd(main).quiet()
    await $`git commit -m baseline`.cwd(main).quiet()
    await $`git worktree add -b worker-task ${linked}`.cwd(main).quiet()
  })
  return { main, linked }
})

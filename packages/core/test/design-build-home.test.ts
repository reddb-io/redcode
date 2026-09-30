import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { DesignBuild } from "../src/design/build"
import { git, initRepo } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"

test("a nested app in a temporary worktree reuses the primary monorepo's hoisted dependencies", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source")
  const worktree = path.join(tmp.path, "redcode-worktrees", "profile")
  await mkdir(path.join(source, "apps", "profile"), { recursive: true })
  await initRepo(source)
  await Bun.write(path.join(source, "apps", "profile", "package.json"), '{"name":"profile"}')
  await git(source, "add", ".")
  await git(source, "commit", "-m", "profile")
  await mkdir(path.join(source, "node_modules"), { recursive: true })
  await git(source, "worktree", "add", "-b", "profile", worktree)
  const application = path.join(worktree, "apps", "profile")
  expect(await DesignBuild.home(application)).toBe(path.join(source, "apps", "profile"))
  expect(await Bun.file(path.join(worktree, "node_modules")).exists()).toBe(false)
  await mkdir(path.join(worktree, "node_modules"), { recursive: true })
  expect(await DesignBuild.home(application)).toBe(application)
  await git(source, "worktree", "remove", "--force", worktree)
})

test("missing dependencies do not cause a checkout switch in a non-Git project", async () => {
  await using tmp = await tmpdir()
  expect(await DesignBuild.home(tmp.path)).toBe(tmp.path)
})

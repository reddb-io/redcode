import { expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Git } from "@opencode/core/git"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionRepositoryStatus } from "@opencode/core/session/repository-status"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { repositoryStatusFixture } from "./fixture/repository-status"
import { tmpdirScoped } from "./fixture/tmpdir"

const it = testEffect(LayerNode.compile(Git.node))

it.live("omits repository status outside Git", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const git = yield* Git.Service
    expect(yield* SessionRepositoryStatus.capture(git, AbsolutePath.make(directory.path))).toBeUndefined()
  }),
)

it.live("captures a clean primary worktree and an unborn branch", () =>
  Effect.gen(function* () {
    const fixture = yield* repositoryStatusFixture
    const git = yield* Git.Service
    const snapshot = yield* SessionRepositoryStatus.capture(git, fixture.main)
    expect(snapshot).toContain(`- Worktree: ${JSON.stringify(fixture.main)} (main)`)
    expect(snapshot).toContain('- Branch: "main"')
    expect(snapshot).toContain("Changed files: 0 (0 tracked; 0 untracked)")
    const empty = yield* tmpdirScoped()
    yield* Effect.promise(async () => {
      await $`git init`.cwd(empty.path).quiet()
      await $`git symbolic-ref HEAD refs/heads/new-project`.cwd(empty.path).quiet()
    })
    expect(yield* SessionRepositoryStatus.capture(git, AbsolutePath.make(empty.path))).toContain(
      '- Branch: "new-project"',
    )
  }),
)

it.live("counts staged and unstaged paths once, including deleted and individual untracked files", () =>
  Effect.gen(function* () {
    const fixture = yield* repositoryStatusFixture
    yield* Effect.promise(async () => {
      await fs.writeFile(path.join(fixture.main, "tracked.txt"), "staged\n")
      await $`git add tracked.txt`.cwd(fixture.main).quiet()
      await fs.writeFile(path.join(fixture.main, "tracked.txt"), "staged and unstaged\n")
      await fs.unlink(path.join(fixture.main, "other.txt"))
      await fs.mkdir(path.join(fixture.main, "drafts"))
      await fs.writeFile(path.join(fixture.main, "drafts", "one.txt"), "one")
      await fs.writeFile(path.join(fixture.main, "drafts", "two.txt"), "two")
      await fs.writeFile(path.join(fixture.main, "ignored.tmp"), "ignored")
    })
    const git = yield* Git.Service
    const repository = yield* git.repo.discover(fixture.main)
    if (!repository) throw new Error("Expected repository")
    expect(yield* git.worktree.status(repository)).toEqual({
      changed: 4,
      staged: 1,
      unstaged: 2,
      untracked: 2,
      conflicted: 0,
    })
    const nested = AbsolutePath.make(path.join(fixture.main, "drafts"))
    const snapshot = yield* SessionRepositoryStatus.capture(git, nested)
    expect(snapshot).toContain(`- Worktree: ${JSON.stringify(fixture.main)} (main)`)
    expect(snapshot).toContain("Changed files: 4 (2 tracked; 2 untracked)")
  }),
)

it.live("counts a staged rename as one file", () =>
  Effect.gen(function* () {
    const fixture = yield* repositoryStatusFixture
    yield* Effect.promise(() => $`git mv other.txt ${"renamed file.txt"}`.cwd(fixture.main).quiet())
    const git = yield* Git.Service
    const snapshot = yield* SessionRepositoryStatus.capture(git, fixture.main)
    expect(snapshot).toContain("Changed files: 1 (1 tracked; 0 untracked)")
    expect(snapshot).toContain("1 staged; 0 unstaged; 0 conflicted")
  }),
)

it.live("discovers the linked checkout from its subdirectory and excludes the primary checkout's changes", () =>
  Effect.gen(function* () {
    const fixture = yield* repositoryStatusFixture
    const nested = AbsolutePath.make(path.join(fixture.linked, "src"))
    yield* Effect.promise(async () => {
      await fs.writeFile(path.join(fixture.main, "tracked.txt"), "main change\n")
      await fs.writeFile(path.join(fixture.main, "main-only.txt"), "main only")
      await fs.mkdir(nested)
      await fs.writeFile(path.join(fixture.linked, "tracked.txt"), "linked change\n")
    })
    const git = yield* Git.Service
    const snapshot = yield* SessionRepositoryStatus.capture(git, nested)
    expect(snapshot).toContain(`- Worktree: ${JSON.stringify(fixture.linked)} (linked)`)
    expect(snapshot).toContain('- Branch: "worker-task"')
    expect(snapshot).toContain("Changed files: 1 (1 tracked; 0 untracked)")
    expect(snapshot).not.toContain(fixture.main)
    yield* Effect.promise(() => $`git checkout --detach`.cwd(fixture.linked).quiet())
    expect(yield* SessionRepositoryStatus.capture(git, nested)).toMatch(/Branch: detached HEAD at [a-f0-9]{12}/)
  }),
)

it.live("reports merge conflicts without double counting staged and unstaged changes", () =>
  Effect.gen(function* () {
    const fixture = yield* repositoryStatusFixture
    yield* Effect.promise(async () => {
      await fs.writeFile(path.join(fixture.main, "tracked.txt"), "main\n")
      await $`git add tracked.txt`.cwd(fixture.main).quiet()
      await $`git commit -m main-change`.cwd(fixture.main).quiet()
      await fs.writeFile(path.join(fixture.linked, "tracked.txt"), "worker\n")
      await $`git add tracked.txt`.cwd(fixture.linked).quiet()
      await $`git commit -m worker-change`.cwd(fixture.linked).quiet()
      expect((await $`git merge worker-task`.cwd(fixture.main).quiet().nothrow()).exitCode).toBe(1)
    })
    const git = yield* Git.Service
    const snapshot = yield* SessionRepositoryStatus.capture(git, fixture.main)
    expect(snapshot).toContain("Changed files: 1 (1 tracked; 0 untracked)")
    expect(snapshot).toContain("0 staged; 0 unstaged; 1 conflicted")
  }),
)

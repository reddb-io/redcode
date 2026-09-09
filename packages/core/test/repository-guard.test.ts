import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { symlink, mkdir } from "node:fs/promises"
import { RepositoryGuard } from "../src/repository-guard"
import { tmpdir } from "./fixture/tmpdir"
import { gitWorktree } from "./fixture/git-worktree"

describe("repository preflight", () => {
  test("protects dirty primary files and new paths while allowing linked worktrees and non-Git directories", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    expect((await RepositoryGuard.inspect(repo.root))?.linked).toBe(false)
    expect((await RepositoryGuard.inspect(repo.tree))?.linked).toBe(true)
    await expect(Effect.runPromise(RepositoryGuard.assertWrite(path.join(repo.root, "source.txt")))).rejects.toThrow(
      "primary Git checkout",
    )
    await expect(
      Effect.runPromise(RepositoryGuard.assertWrite(path.join(repo.root, "nested/new.txt"))),
    ).rejects.toThrow("primary Git checkout")
    await Effect.runPromise(RepositoryGuard.assertWrite(path.join(repo.tree, "source.txt")))
    await Effect.runPromise(RepositoryGuard.assertWrite(path.join(tmp.path, "non-git/new.txt")))
    await expect(Effect.runPromise(RepositoryGuard.assertWrite(path.join(repo.tree, ".git")))).rejects.toThrow(
      "Git metadata",
    )
    expect(await Bun.file(path.join(repo.root, "source.txt")).text()).toBe("user changes\n")
    expect(await Bun.file(path.join(repo.root, "untracked.txt")).text()).toBe("keep me\n")
  })

  test("follows directory links when validating a new file", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    await symlink(repo.root, path.join(repo.tree, "outside"), process.platform === "win32" ? "junction" : "dir")
    await expect(
      Effect.runPromise(RepositoryGuard.assertWrite(path.join(repo.tree, "outside/new.txt"))),
    ).rejects.toThrow("primary Git checkout")
  })

  test("permits preflight and safe external worktree creation but rejects writes and nested worktree setup", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    await Effect.runPromise(RepositoryGuard.assertShell(repo.root, "git status --short"))
    await Effect.runPromise(RepositoryGuard.assertShell(repo.root, "git push origin task-worktree"))
    await Effect.runPromise(RepositoryGuard.assertShell(repo.root, `git -C "${repo.root}" push origin task-worktree`))
    await Effect.runPromise(RepositoryGuard.assertShell(repo.tree, `git -C "${repo.root}" --no-pager status --short`))
    await Effect.runPromise(
      RepositoryGuard.assertShell(repo.root, `git worktree add -b next-task "${path.join(tmp.path, "next")}" HEAD`),
    )
    await expect(
      Effect.runPromise(
        RepositoryGuard.assertShell(repo.root, `git worktree add -b nested "${path.join(repo.root, "nested")}" HEAD`),
      ),
    ).rejects.toThrow("separate linked worktree")
    await expect(Effect.runPromise(RepositoryGuard.assertShell(repo.root, "touch source.txt"))).rejects.toThrow(
      "separate linked worktree",
    )
    await expect(
      Effect.runPromise(RepositoryGuard.assertShell(repo.tree, `git -C "${repo.root}" commit -am change`)),
    ).rejects.toThrow("primary Git checkout")
    await Effect.runPromise(RepositoryGuard.assertShell(repo.tree, "bun test"))
  })

  test.each([
    "git --work-tree=/tmp/source status",
    "git --git-dir /tmp/source/.git commit",
    "git reset",
    "git stash list",
    "git clean -fdx",
    "git restore source.txt",
    "git checkout -- source.txt",
    "git -C /tmp/reset reset --hard",
    "git -c color.ui=false stash",
    "git --no-pager clean -fd",
    "echo ok && /usr/bin/git reset --hard",
    "env git reset",
    "sh -c 'git reset --hard'",
    "g'it' re\"set\" --hard",
    "git \\\nreset --hard",
    "git push --force-with-lease",
    "git push origin +HEAD:main",
    "git branch -D topic",
    "git switch --discard-changes main",
    "git worktree remove task",
    "git reflog expire --all",
    "GIT_WORK_TREE=/tmp/source git commit -am change",
  ])("blocks %s", (command) => expect(RepositoryGuard.forbidden(command)).toBeDefined())

  test.each([
    "git status --short",
    "git diff",
    "git log -3",
    "git worktree list",
    "git commit -m 'fix: handle reset state'",
    "git push origin task",
  ])("allows preserving Git operation %s", (command) => expect(RepositoryGuard.forbidden(command)).toBeUndefined())

  test("prepares an artifact worktree outside the checkout and reuses a linked worktree", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    await mkdir(path.join(repo.root, "app"))
    const prepared = await RepositoryGuard.prepare(repo.root)
    expect(prepared).toContain(".redcode-worktrees")
    expect((await RepositoryGuard.inspect(prepared))?.linked).toBe(true)
    expect(await RepositoryGuard.prepare(prepared)).toBe(prepared)
    expect(await Bun.file(path.join(prepared, "source.txt")).text()).toBe("committed\n")
    expect(await Bun.file(path.join(repo.root, "source.txt")).text()).toBe("user changes\n")
  })

  test("preflight reuses the session worktree across concurrent calls and later resumption", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    const [first, second] = await Promise.all([
      RepositoryGuard.prepare(repo.root, "session-a"),
      RepositoryGuard.prepare(repo.root, "session-a"),
    ])
    expect(first).toBe(second)
    await Bun.write(path.join(first, "draft.txt"), "keep this draft")
    expect(await RepositoryGuard.prepare(repo.root, "session-a")).toBe(first)
    expect(await RepositoryGuard.prepare(repo.root, "session-b")).not.toBe(first)
    expect(await Bun.file(path.join(first, "draft.txt")).text()).toBe("keep this draft")
    const preflight = await RepositoryGuard.preflight(repo.root, "session-a")
    expect(preflight).toContain("draft.txt")
    expect(preflight).toContain("Source status:")
    expect(preflight).toContain("untracked.txt")
    expect(preflight).toContain(" M source.txt")
  })
})

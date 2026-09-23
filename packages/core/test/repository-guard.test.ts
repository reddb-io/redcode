import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { symlink, mkdir, readdir, realpath } from "node:fs/promises"
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

describe("session worktree", () => {
  test.each([
    ["Fix the setup flow", "fix-setup-flow"],
    ["Implement PR auto-worktree in the monorepo", "implement-pr-auto"],
    ["Refactor-Session_Runner v2!!", "refactor-session-runner"],
    ["Corrigir a navegação do diálogo", "corrigir-navegacao-dialogo"],
    ["Straße über Ærø", "strasse-uber-aero"],
    ["Supercalifragilisticexpialidocious test", "supercalifragilistic-test"],
    ["the a to", "the-a-to"],
    ["修复登录", "task"],
    ["   ---   ", "task"],
    ["", "task"],
  ])("slug of %p is %p", (text, expected) => expect(RepositoryGuard.slug(text)).toBe(expected))

  test.each([
    ["setup-flow", [], "setup-flow"],
    ["setup-flow", ["setup-flow"], "setup-flow-2"],
    ["setup-flow", ["setup-flow", "setup-flow-2"], "setup-flow-3"],
    ["setup-flow", ["setup-flow-2"], "setup-flow"],
    ["task", ["task", "task-3"], "task-2"],
  ])("next name for %p taken %p is %p", (name, taken, expected) =>
    expect(RepositoryGuard.nextName(name, new Set(taken))).toBe(expected),
  )

  test("creates a nested worktree from HEAD, hides it from status and preserves the primary checkout", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    const root = await realpath(repo.root)
    const claim = await RepositoryGuard.claim({ directory: repo.root, session: "ses_a", name: "Fix the setup flow" })
    const worktree = path.join(root, ".red", "worktrees", "fix-setup-flow")
    expect(claim).toEqual({ root, worktree, branch: "fix-setup-flow", created: true })
    expect((await RepositoryGuard.inspect(worktree))?.linked).toBe(true)
    expect(await Bun.file(path.join(worktree, "source.txt")).text()).toBe("committed\n")
    expect(await Bun.file(path.join(repo.root, "source.txt")).text()).toBe("user changes\n")
    expect(await Bun.file(path.join(repo.root, "untracked.txt")).text()).toBe("keep me\n")
    expect(await Bun.file(path.join(repo.root, ".git", "info", "exclude")).text()).toContain(".red/worktrees/")
    const status = Bun.spawnSync(["git", "-C", repo.root, "status", "--porcelain"]).stdout.toString()
    expect(status).toContain("untracked.txt")
    expect(status).not.toContain(".red")

    expect(await RepositoryGuard.relocate(claim!, path.join(repo.root, "src", "new.txt"))).toBe(
      path.join(worktree, "src", "new.txt"),
    )
    expect(await RepositoryGuard.relocate(claim!, path.join(worktree, "source.txt"))).toBe(
      path.join(worktree, "source.txt"),
    )
    expect(await RepositoryGuard.relocate(claim!, path.join(repo.tree, "source.txt"))).toBe(
      path.join(repo.tree, "source.txt"),
    )
  })

  test("reuses the session's worktree and suffixes a colliding branch or directory", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    const first = await RepositoryGuard.claim({ directory: repo.root, session: "ses_a", name: "Fix the setup flow" })
    expect(await RepositoryGuard.claim({ directory: repo.root, session: "ses_a", name: "Something else" })).toEqual({
      ...first!,
      created: false,
    })
    expect(
      (await RepositoryGuard.claim({ directory: repo.root, session: "ses_b", name: "fix setup flow" }))?.branch,
    ).toBe("fix-setup-flow-2")
    // The fixture already owns a `task-worktree` branch.
    expect(
      (await RepositoryGuard.claim({ directory: repo.root, session: "ses_c", name: "Task worktree" }))?.branch,
    ).toBe("task-worktree-2")
    expect((await readdir(path.join(repo.root, ".red", "worktrees"))).toSorted()).toEqual([
      "fix-setup-flow",
      "fix-setup-flow-2",
      "task-worktree-2",
    ])
    const exclude = await Bun.file(path.join(repo.root, ".git", "info", "exclude")).text()
    expect(exclude.match(/\.red\/worktrees\//g)).toHaveLength(1)
    expect(
      await RepositoryGuard.claim({ directory: first!.worktree, session: "ses_d", name: "Nested" }),
    ).toBeUndefined()
    expect(await RepositoryGuard.claim({ directory: first!.worktree, session: "ses_a", name: "Nested" })).toEqual({
      ...first!,
      created: false,
    })
    expect(await RepositoryGuard.claim({ directory: repo.tree, session: "ses_a", name: "Nested" })).toBeUndefined()
  })

  test("keeps serving a worktree that worktree_prepare made for the session", async () => {
    await using tmp = await tmpdir()
    const repo = await gitWorktree(tmp.path)
    const prepared = await RepositoryGuard.prepare(repo.root, "ses_p")
    expect(await RepositoryGuard.claim({ directory: repo.root, session: "ses_p", name: "Anything" })).toEqual({
      root: await realpath(repo.root),
      worktree: prepared,
      branch: path.basename(prepared),
      created: false,
    })
  })

  test("does nothing outside Git or in YOLO mode", async () => {
    await using tmp = await tmpdir()
    const plain = path.join(tmp.path, "plain")
    await mkdir(plain)
    expect(await RepositoryGuard.claim({ directory: plain, session: "ses_a", name: "Fix it" })).toBeUndefined()
    const repo = await gitWorktree(tmp.path)
    const previous = process.env.REDCODE_YOLO
    process.env.REDCODE_YOLO = "1"
    const claim = await RepositoryGuard.claim({ directory: repo.root, session: "ses_a", name: "Fix it" }).finally(
      () => {
        if (previous === undefined) delete process.env.REDCODE_YOLO
        else process.env.REDCODE_YOLO = previous
      },
    )
    expect(claim).toBeUndefined()
    expect(await Bun.file(path.join(repo.root, ".red", "worktrees", "fix", ".git")).exists()).toBe(false)
  })

  test.each([
    ["git status --short | head -5", true],
    ["rg foo | sort | head", true],
    ["git log --oneline | grep fix", true],
    ["ls", true],
    ["git status | sort -o out.txt", false],
    ["git status > out.txt", false],
    ["git status || touch x", false],
    ["bun test", false],
    ["cat a | tee b", false],
  ])("read-only %p is %p", (command, expected) => expect(RepositoryGuard.readOnly(command)).toBe(expected))
})

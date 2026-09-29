import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { WorktreePlacement } from "@opencode/core/worktree/placement"
import { initRepo } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"

describe("worktree placement precedence", () => {
  test("defaults to the repository and follows worktree.location", () => {
    expect(WorktreePlacement.location(undefined, {})).toBe("repo")
    expect(WorktreePlacement.location({ location: "tmp" }, {})).toBe("tmp")
    expect(WorktreePlacement.location({ location: "repo" }, {})).toBe("repo")
  })

  test("REDCODE_WORKTREE_LOCATION overrides the config in either direction", () => {
    expect(WorktreePlacement.location({ location: "repo" }, { REDCODE_WORKTREE_LOCATION: "tmp" })).toBe("tmp")
    expect(WorktreePlacement.location({ location: "tmp" }, { REDCODE_WORKTREE_LOCATION: "repo" })).toBe("repo")
    expect(WorktreePlacement.location(undefined, { OPENCODE_WORKTREE_LOCATION: "tmp" })).toBe("tmp")
    expect(
      WorktreePlacement.location(undefined, { REDCODE_WORKTREE_LOCATION: "repo", OPENCODE_WORKTREE_LOCATION: "tmp" }),
    ).toBe("repo")
  })

  test("an unknown or empty location falls back to the config", () => {
    expect(WorktreePlacement.location({ location: "tmp" }, { REDCODE_WORKTREE_LOCATION: "elsewhere" })).toBe("tmp")
    expect(WorktreePlacement.location({ location: "tmp" }, { REDCODE_WORKTREE_LOCATION: "" })).toBe("tmp")
  })

  test("a Session's client environment replaces the server's", () => {
    const server = { REDCODE_WORKTREE_LOCATION: "tmp", REDCODE_AUTO_WORKTREE: "0" }
    const client = { HOME: "/home/user" }
    expect(WorktreePlacement.location(undefined, WorktreePlacement.environment(client, server))).toBe("repo")
    expect(WorktreePlacement.automatic(undefined, WorktreePlacement.environment(client, server))).toBe(true)
    expect(WorktreePlacement.location(undefined, WorktreePlacement.environment(undefined, server))).toBe("tmp")
    expect(WorktreePlacement.automatic(undefined, WorktreePlacement.environment(undefined, server))).toBe(false)
  })

  test("worktree.auto: false and REDCODE_AUTO_WORKTREE=0 each turn automatic worktrees off", () => {
    expect(WorktreePlacement.automatic(undefined, {})).toBe(true)
    expect(WorktreePlacement.automatic({ auto: true }, {})).toBe(true)
    expect(WorktreePlacement.automatic({ auto: false }, {})).toBe(false)
    expect(WorktreePlacement.automatic(undefined, { REDCODE_AUTO_WORKTREE: "0" })).toBe(false)
    expect(WorktreePlacement.automatic(undefined, { OPENCODE_AUTO_WORKTREE: "0" })).toBe(false)
    expect(WorktreePlacement.automatic({ auto: false }, { REDCODE_AUTO_WORKTREE: "1" })).toBe(false)
  })
})

describe("worktree placement paths", () => {
  const root = path.join(path.sep, "work", "repo")

  test("puts repository worktrees under .red/worktrees", () => {
    expect(WorktreePlacement.parent({ root, environment: {} })).toBe(path.join(root, ".red", "worktrees"))
  })

  test("puts temporary worktrees under <tmpdir>/redcode-worktrees/<repository>-<hash>", () => {
    const tmp = path.join(path.sep, "scratch")
    const parent = WorktreePlacement.parent({
      root,
      settings: { tmpdir: tmp },
      environment: { REDCODE_WORKTREE_LOCATION: "tmp" },
    })
    expect(path.dirname(parent)).toBe(path.join(tmp, "redcode-worktrees"))
    expect(path.basename(parent)).toMatch(/^repo-[0-9a-f]{8}$/)
    expect(WorktreePlacement.parent({ root, settings: { location: "tmp", tmpdir: tmp }, environment: {} })).toBe(parent)
    expect(WorktreePlacement.temporaryParent(path.join(path.sep, "other", "repo"), tmp)).not.toBe(parent)
    expect(WorktreePlacement.temporary(path.join(parent, "fix-login"))).toBe(true)
    expect(WorktreePlacement.temporary(path.join(root, ".red", "worktrees", "fix-login"))).toBe(false)
  })

  test("a temporary location wins over worktree.directory, which serves the repository location", () => {
    const settings = { directory: "../trees", tmpdir: path.join(path.sep, "scratch") }
    expect(WorktreePlacement.parent({ root, settings, environment: {} })).toBe(path.resolve(root, "../trees"))
    expect(WorktreePlacement.parent({ root, settings: { ...settings, location: "tmp" }, environment: {} })).toBe(
      WorktreePlacement.temporaryParent(root, settings.tmpdir),
    )
  })
})

describe("worktree names", () => {
  test("uses up to three words of the task, preferring longer ones", () => {
    expect(WorktreePlacement.slug("Fix the login redirect bug")).toBe("fix-the-login")
    expect(WorktreePlacement.slug("add a UI to it")).toBe("add")
    expect(WorktreePlacement.slug("go to db")).toBe("go-to-db")
  })

  test("keeps letters of every script and drops accents", () => {
    expect(WorktreePlacement.slug("Corrigir a navegação do login")).toBe("corrigir-navegacao-login")
    expect(WorktreePlacement.slug("修复登录")).toBe("修复登录")
  })

  test("falls back to task", () => {
    expect(WorktreePlacement.slug("")).toBe("task")
    expect(WorktreePlacement.slug("!!! ???")).toBe("task")
  })

  test("adds the first free numeric suffix", () => {
    expect(WorktreePlacement.nextName("fix-login", new Set())).toBe("fix-login")
    expect(WorktreePlacement.nextName("fix-login", new Set(["fix-login", "fix-login-2"]))).toBe("fix-login-3")
    expect(WorktreePlacement.nextName("fix-login", new Set(["fix-login", "fix-login-3"]))).toBe("fix-login-2")
  })
})

describe("temporary worktrees in a real repository", () => {
  test("are linked worktrees on their own branch and leave .git/info/exclude alone", async () => {
    await using dir = await tmpdir()
    const repository = path.join(dir.path, "repo")
    await fs.mkdir(repository)
    await initRepo(repository)
    const exclude = path.join(repository, ".git", "info", "exclude")
    const before = await Bun.file(exclude)
      .text()
      .catch(() => "")
    const parent = WorktreePlacement.parent({
      root: repository,
      settings: { tmpdir: path.join(dir.path, "tmp") },
      environment: { REDCODE_WORKTREE_LOCATION: "tmp" },
    })
    const name = WorktreePlacement.nextName(WorktreePlacement.slug("Fix the login redirect"), new Set())
    const directory = path.join(parent, name)
    await fs.mkdir(parent, { recursive: true })
    await $`git worktree add --detach -- ${directory} HEAD`.cwd(repository).quiet()
    await $`git switch -c ${name}`.cwd(directory).quiet()

    expect(directory).toBe(path.join(dir.path, "tmp", "redcode-worktrees", path.basename(parent), "fix-the-login"))
    expect((await $`git symbolic-ref --short HEAD`.cwd(directory).text()).trim()).toBe(name)
    // A linked worktree has a `.git` file pointing at the repository instead of its own `.git` directory.
    expect((await fs.stat(path.join(directory, ".git"))).isFile()).toBe(true)
    expect(
      await Bun.file(exclude)
        .text()
        .catch(() => ""),
    ).toBe(before)
  })
})

import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse, pending, removable, type Entry } from "../src/commands/handlers/worktrees/inventory"

const entry = (overrides: Partial<Entry>): Entry => ({
  directory: "/tmp/redcode-worktrees/repo-0123abcd/fix-login",
  path: "/tmp/redcode-worktrees/repo-0123abcd/fix-login",
  head: "0123456789abcdef0123456789abcdef01234567",
  branch: "fix-login",
  locked: false,
  prunable: false,
  strategy: "git",
  registered: true,
  primary: false,
  current: false,
  temporary: true,
  size: 1024,
  sizePartial: false,
  changes: { tracked: 0, untracked: 0 },
  merged: true,
  activity: 1_000,
  sessions: [],
  ...overrides,
})

describe("worktrees clean rules", () => {
  test("removes a clean merged worktree, temporary or not", () => {
    expect(removable(entry({}), { merged: true })).toBe(true)
    expect(
      removable(entry({ temporary: false, directory: "/work/repo/.red/worktrees/fix-login" }), { merged: true }),
    ).toBe(true)
  })

  test("never removes a worktree with uncommitted changes", () => {
    expect(removable(entry({ changes: { tracked: 1, untracked: 0 } }), { merged: true })).toBe(false)
    expect(removable(entry({ changes: { tracked: 0, untracked: 1 } }), { merged: true, cutoff: 5_000 })).toBe(false)
    expect(removable(entry({ changes: undefined }), { merged: true })).toBe(false)
  })

  test("removes a stale worktree only when it was last active before the cutoff", () => {
    expect(removable(entry({ merged: false, activity: 1_000 }), { merged: false, cutoff: 2_000 })).toBe(true)
    expect(removable(entry({ merged: false, activity: 3_000 }), { merged: false, cutoff: 2_000 })).toBe(false)
    expect(removable(entry({ merged: false }), { merged: true })).toBe(false)
  })

  test("keeps the primary checkout and current, locked, missing or unmanaged worktrees", () => {
    expect(removable(entry({ primary: true }), { merged: true })).toBe(false)
    expect(removable(entry({ current: true }), { merged: true })).toBe(false)
    expect(removable(entry({ locked: true }), { merged: true })).toBe(false)
    expect(removable(entry({ prunable: true }), { merged: true })).toBe(false)
    expect(removable(entry({ registered: false }), { merged: true })).toBe(false)
    expect(removable(entry({ strategy: undefined }), { merged: true })).toBe(false)
  })
})

describe("worktrees inventory in a real repository", () => {
  test("counts changes in a temporary worktree and marks it prunable once its directory is gone", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "redcode-worktrees-clean-")))
    try {
      const repository = path.join(root, "repo")
      await fs.mkdir(repository)
      await $`git init`.cwd(repository).quiet()
      await $`git config user.email test@redcode.test`.cwd(repository).quiet()
      await $`git config user.name Test`.cwd(repository).quiet()
      await $`git config commit.gpgsign false`.cwd(repository).quiet()
      await $`git commit --allow-empty -m root`.cwd(repository).quiet()
      const directory = path.join(root, "tmp", "redcode-worktrees", "repo-0123abcd", "fix-login")
      await $`git worktree add -b fix-login -- ${directory} HEAD`.cwd(repository).quiet()

      const listed = parse(await $`git worktree list --porcelain`.cwd(repository).text())
      expect(listed.find((item) => item.branch === "fix-login")?.prunable).toBe(false)
      expect(await pending(directory)).toEqual({ tracked: 0, untracked: 0 })

      await Bun.write(path.join(directory, "notes.txt"), "draft\n")
      expect(await pending(directory)).toEqual({ tracked: 0, untracked: 1 })

      await fs.rm(directory, { recursive: true, force: true })
      const missing = parse(await $`git worktree list --porcelain`.cwd(repository).text())
      expect(missing.find((item) => item.branch === "fix-login")?.prunable).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

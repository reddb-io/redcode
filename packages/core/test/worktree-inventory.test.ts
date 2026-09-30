import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WorktreeInventory } from "@opencode/core/worktree/inventory"

const entry = (overrides: Partial<WorktreeInventory.Entry>): WorktreeInventory.Entry => ({
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
    expect(WorktreeInventory.removable(entry({}), { merged: true })).toBe(true)
    expect(
      WorktreeInventory.removable(entry({ temporary: false, directory: "/work/repo/.red/worktrees/fix-login" }), {
        merged: true,
      }),
    ).toBe(true)
  })

  test("never removes a worktree with uncommitted changes", () => {
    expect(WorktreeInventory.removable(entry({ changes: { tracked: 1, untracked: 0 } }), { merged: true })).toBe(false)
    expect(
      WorktreeInventory.removable(entry({ changes: { tracked: 0, untracked: 1 } }), { merged: true, cutoff: 5_000 }),
    ).toBe(false)
    expect(WorktreeInventory.removable(entry({ changes: undefined }), { merged: true })).toBe(false)
  })

  test("removes a stale worktree only when it was last active before the cutoff", () => {
    expect(
      WorktreeInventory.removable(entry({ merged: false, activity: 1_000 }), { merged: false, cutoff: 2_000 }),
    ).toBe(true)
    expect(
      WorktreeInventory.removable(entry({ merged: false, activity: 3_000 }), { merged: false, cutoff: 2_000 }),
    ).toBe(false)
    expect(WorktreeInventory.removable(entry({ merged: false }), { merged: true })).toBe(false)
  })

  test("keeps the primary checkout and current, locked, missing or unmanaged worktrees", () => {
    expect(WorktreeInventory.removable(entry({ primary: true }), { merged: true })).toBe(false)
    expect(WorktreeInventory.removable(entry({ current: true }), { merged: true })).toBe(false)
    expect(WorktreeInventory.removable(entry({ locked: true }), { merged: true })).toBe(false)
    expect(WorktreeInventory.removable(entry({ prunable: true }), { merged: true })).toBe(false)
    expect(WorktreeInventory.removable(entry({ registered: false }), { merged: true })).toBe(false)
    expect(WorktreeInventory.removable(entry({ strategy: undefined }), { merged: true })).toBe(false)
  })
})

describe("worktree rows", () => {
  test("names the state from missing, unknown, dirty, merged and clean", () => {
    expect(WorktreeInventory.state(entry({ prunable: true }))).toBe("missing")
    expect(WorktreeInventory.state(entry({ changes: undefined }))).toBe("unknown")
    expect(WorktreeInventory.state(entry({ changes: { tracked: 1, untracked: 2 } }))).toBe("dirty")
    expect(WorktreeInventory.state(entry({}))).toBe("merged")
    expect(WorktreeInventory.state(entry({ merged: false }))).toBe("clean")
  })

  test("summarizes state, placement, size and last activity on one line", () => {
    const now = 1_000 + 2 * 86_400_000
    expect(WorktreeInventory.summary(entry({}), now)).toBe("merged · tmp · 1.0K · 2d ago")
    expect(
      WorktreeInventory.summary(
        entry({ temporary: false, locked: true, changes: { tracked: 2, untracked: 1 }, sizePartial: true }),
        now,
      ),
    ).toBe("dirty 3 · locked · ≥1.0K · 2d ago")
    expect(WorktreeInventory.summary(entry({ changes: undefined, activity: undefined }), now)).toBe("unknown · tmp")
  })

  test("formats elapsed time in its largest whole unit", () => {
    expect(WorktreeInventory.age(-5)).toBe("0s")
    expect(WorktreeInventory.age(45_000)).toBe("45s")
    expect(WorktreeInventory.age(12 * 60_000)).toBe("12m")
    expect(WorktreeInventory.age(3 * 3_600_000)).toBe("3h")
    expect(WorktreeInventory.age(5 * 86_400_000)).toBe("5d")
    expect(WorktreeInventory.age(8 * 604_800_000)).toBe("8w")
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

      const listed = WorktreeInventory.parse(await $`git worktree list --porcelain`.cwd(repository).text())
      expect(listed.find((item) => item.branch === "fix-login")?.prunable).toBe(false)
      expect(await WorktreeInventory.pending(directory)).toEqual({ tracked: 0, untracked: 0 })

      await Bun.write(path.join(directory, "notes.txt"), "draft\n")
      expect(await WorktreeInventory.pending(directory)).toEqual({ tracked: 0, untracked: 1 })

      await fs.rm(directory, { recursive: true, force: true })
      const missing = WorktreeInventory.parse(await $`git worktree list --porcelain`.cwd(repository).text())
      expect(missing.find((item) => item.branch === "fix-login")?.prunable).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

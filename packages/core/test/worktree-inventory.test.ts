import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, realpath, rm } from "node:fs/promises"
import { WorktreeInventory } from "../src/worktree-inventory"
import { tmpdir } from "./fixture/tmpdir"

const git = (directory: string, ...args: string[]) => {
  const result = Bun.spawnSync(
    ["git", "-C", directory, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}

/**
 * A primary checkout on `main` with four linked worktrees: `merged` (no commits of its own),
 * `feature` (one commit ahead), `dirty` (merged but with an untracked file) and `outside`
 * (next to the repository instead of under `.red/worktrees`).
 */
async function fixture(directory: string) {
  const root = path.join(directory, "repo")
  await mkdir(root)
  git(root, "init", "--quiet", "-b", "main")
  git(root, "config", "core.autocrlf", "false")
  await Bun.write(path.join(root, "source.txt"), "committed\n")
  git(root, "add", "source.txt")
  git(root, "commit", "--quiet", "-m", "fixture")
  const nested = (name: string) => path.join(root, ".red", "worktrees", name)
  git(root, "worktree", "add", "--quiet", "-b", "merged", nested("merged"))
  git(root, "worktree", "add", "--quiet", "-b", "feature", nested("feature"))
  await Bun.write(path.join(nested("feature"), "feature.txt"), "work\n")
  git(nested("feature"), "add", "feature.txt")
  git(nested("feature"), "commit", "--quiet", "-m", "feature")
  git(root, "worktree", "add", "--quiet", "-b", "dirty", nested("dirty"))
  await Bun.write(path.join(nested("dirty"), "draft.txt"), "unsaved\n")
  git(root, "worktree", "add", "--quiet", "-b", "outside", path.join(directory, "outside"))
  return { root: await realpath(root), nested: async (name: string) => realpath(nested(name)) }
}

describe("worktree inventory", () => {
  test("parses porcelain records", () => {
    expect(
      WorktreeInventory.parse(
        [
          "worktree /repo",
          "HEAD aaa",
          "branch refs/heads/main",
          "",
          "worktree /repo/.red/worktrees/x",
          "HEAD bbb",
          "detached",
          "locked reason",
          "",
          "worktree /gone",
          "HEAD ccc",
          "branch refs/heads/gone",
          "prunable gitdir file points to non-existent location",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "/repo", head: "aaa", branch: "main", locked: false, prunable: false },
      { path: "/repo/.red/worktrees/x", head: "bbb", locked: true, prunable: false },
      { path: "/gone", head: "ccc", branch: "gone", locked: false, prunable: true },
    ])
  })

  test("lists worktrees with placement, changes, divergence, merge state, size and activity", async () => {
    await using tmp = await tmpdir()
    const repo = await fixture(tmp.path)
    const inventory = await WorktreeInventory.list({ directory: await repo.nested("feature") })
    expect(inventory.root).toBe(repo.root)
    expect(inventory.base).toBe("main")
    const find = (branch: string) => inventory.worktrees.find((item) => item.branch === branch)!
    expect(inventory.worktrees[0]).toMatchObject({ path: repo.root, branch: "main", primary: true, current: false })
    expect(find("feature")).toMatchObject({
      relative: ".red/worktrees/feature",
      primary: false,
      current: true,
      ahead: 1,
      behind: 0,
      merged: false,
      changes: { tracked: 0, untracked: 0 },
    })
    expect(find("merged")).toMatchObject({ merged: true, current: false, ahead: 0 })
    expect(find("dirty")).toMatchObject({ merged: true, changes: { tracked: 0, untracked: 1 } })
    expect(find("outside").relative).toBeUndefined()
    expect(find("feature").size).toBeGreaterThan(0)
    expect(find("feature").activity).toBeGreaterThan(Date.now() - 3_600_000)
  })

  test("refuses the primary checkout, the current worktree and unconfirmed pending changes", async () => {
    await using tmp = await tmpdir()
    const repo = await fixture(tmp.path)
    const directory = await repo.nested("feature")
    await expect(WorktreeInventory.remove({ directory, target: repo.root })).rejects.toThrow("primary checkout")
    await expect(WorktreeInventory.remove({ directory, target: "feature" })).rejects.toThrow("current worktree")
    await expect(WorktreeInventory.remove({ directory: repo.root, target: "dirty" })).rejects.toThrow(
      "1 uncommitted change",
    )
    expect(await Bun.file(path.join(await repo.nested("dirty"), "draft.txt")).text()).toBe("unsaved\n")
    await expect(
      WorktreeInventory.remove({ directory: repo.root, target: "merged", protect: [await repo.nested("merged")] }),
    ).rejects.toThrow("current worktree")
  })

  test("removes by path or branch, deleting only merged branches", async () => {
    await using tmp = await tmpdir()
    const repo = await fixture(tmp.path)
    const merged = await WorktreeInventory.remove({
      directory: repo.root,
      target: ".red/worktrees/merged",
      deleteBranch: true,
    })
    expect(merged).toMatchObject({ branch: "merged", branchDeleted: true })
    expect(merged.freed).toBeGreaterThan(0)
    const feature = await WorktreeInventory.remove({ directory: repo.root, target: "feature", deleteBranch: true })
    expect(feature).toMatchObject({ branch: "feature", branchDeleted: false })
    expect(git(repo.root, "branch", "--list", "merged", "feature").trim()).toBe("feature")
    const dirty = await WorktreeInventory.remove({ directory: repo.root, target: "dirty", force: true })
    expect(await Bun.file(path.join(dirty.path, "draft.txt")).exists()).toBe(false)
    expect(
      (await WorktreeInventory.list({ directory: repo.root })).worktrees.map((item) => item.branch).toSorted(),
    ).toEqual(["main", "outside"])
  })

  test("clean previews, then removes clean merged worktrees and prunes stale registrations", async () => {
    await using tmp = await tmpdir()
    const repo = await fixture(tmp.path)
    await rm(path.join(tmp.path, "outside"), { recursive: true, force: true })
    const merged = await repo.nested("merged")
    const preview = await WorktreeInventory.clean({ directory: repo.root, dryRun: true })
    expect(preview.candidates.map((item) => item.branch)).toEqual(["merged"])
    expect(preview.pruned).toEqual(["outside"])
    expect(preview.freed).toBeGreaterThan(0)
    expect(await Bun.file(path.join(merged, "source.txt")).exists()).toBe(true)

    const result = await WorktreeInventory.clean({ directory: repo.root })
    expect(result.removed).toEqual([merged])
    expect(result.failed).toEqual([])
    const left = await WorktreeInventory.list({ directory: repo.root })
    expect(left.worktrees.map((item) => item.branch).toSorted()).toEqual(["dirty", "feature", "main"])
    expect(git(repo.root, "branch", "--list", "merged").trim()).toBe("")
  })

  test("clean by staleness keeps recently active worktrees", async () => {
    await using tmp = await tmpdir()
    const repo = await fixture(tmp.path)
    const preview = await WorktreeInventory.clean({ directory: repo.root, staleDays: 7, dryRun: true })
    expect(preview.candidates).toEqual([])
  })

  test("refuses a directory outside Git", async () => {
    await using tmp = await tmpdir()
    await expect(WorktreeInventory.list({ directory: tmp.path })).rejects.toThrow("not inside a Git repository")
  })
})

describe("worktree summary", () => {
  test.each([
    [0, "0B"],
    [512, "512B"],
    [4300, "4.2K"],
    [31 * 1024 ** 2, "31M"],
    [1.2 * 1024 ** 3, "1.2G"],
  ])("bytes %p is %p", (value, expected) => expect(WorktreeInventory.bytes(value)).toBe(expected))

  test.each([
    [30_000, "now"],
    [5 * 60_000, "5m"],
    [3 * 3_600_000, "3h"],
    [3 * 86_400_000, "3d"],
    [21 * 86_400_000, "3w"],
    [120 * 86_400_000, "4mo"],
    [400 * 86_400_000, "1y"],
  ])("age %p is %p", (value, expected) => expect(WorktreeInventory.age(value)).toBe(expected))

  test("compacts a row", () => {
    const now = Date.now()
    expect(
      WorktreeInventory.summary(
        {
          path: "/repo/.red/worktrees/setup-flow",
          relative: ".red/worktrees/setup-flow",
          branch: "setup-flow",
          head: "abcdef123456",
          primary: false,
          current: false,
          locked: false,
          prunable: false,
          size: 1.2 * 1024 ** 3,
          sizePartial: false,
          changes: { tracked: 2, untracked: 1 },
          merged: false,
          activity: now - 3 * 86_400_000,
          sessions: [],
        },
        now,
      ),
    ).toEqual({ location: "⎇ .red/worktrees/setup-flow", branch: "⑂ setup-flow", size: "1.2G", state: "dirty·3d" })
  })
})

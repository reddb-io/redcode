import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect, test } from "bun:test"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Worktree } from "@opencode/schema/worktree"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { initRepo } from "../../core/test/fixture/git"
import { applyIntegration, prepareIntegration } from "../src/worktree-review"

async function fixture() {
  const tmp = await tmpdir("redcode-combined-results-")
  const target = AbsolutePath.make(path.join(tmp.path, "target"))
  await fs.mkdir(target)
  await initRepo(target)
  const sources: { directory: AbsolutePath; head: string }[] = []
  // Git's worktree registration shares repository metadata even for distinct checkout paths.
  for (const name of ["first", "second", "third"]) {
    const directory = AbsolutePath.make(path.join(tmp.path, name))
    await $`git worktree add --detach ${directory} HEAD`.cwd(target).quiet()
    sources.push({ directory, head: (await $`git rev-parse HEAD`.cwd(directory).quiet()).text().trim() })
  }
  const input = {
    projectID: Project.ID.make("project_combined"),
    target,
    targetHead: sources[0]!.head,
    sources: sources.slice(0, 2),
  }
  const inventory: Worktree.List = [
    { directory: target },
    ...sources.map((source) => ({ directory: source.directory, strategy: "git" })),
  ]
  return { ...tmp, target, sources, input, inventory }
}

async function change(directory: string, name: string, content: string) {
  await Bun.write(path.join(directory, name), content)
  await $`git add --all`.cwd(directory).quiet()
  await $`git commit -m result`.cwd(directory).quiet()
  return (await $`git rev-parse HEAD`.cwd(directory).quiet()).text().trim()
}

test("prepares reproducible divergent results and applies exactly the reviewed commit", async () => {
  await using repo = await fixture()
  repo.input.sources[0]!.head = await change(
    repo.sources[0]!.directory,
    "sum.ts",
    "export const sum = (a: number, b: number) => a + b\n",
  )
  repo.input.sources[1]!.head = await change(
    repo.sources[1]!.directory,
    "run.ts",
    "import { sum } from './sum'; export const run = (a: number, b: number) => 2 * sum(a, b)\n",
  )
  const refs = (await $`git show-ref`.cwd(repo.target).quiet()).text()
  const candidate = await prepareIntegration(repo.input, repo.inventory)
  expect(candidate.status).toBe("ready")
  expect(candidate.steps.map((step) => step.status)).toEqual(["fast_forward", "merged"])
  expect(candidate.diff).toContain("sum.ts")
  expect(candidate.diff).toContain("run.ts")
  expect(candidate).toEqual(await prepareIntegration(repo.input, repo.inventory))
  expect((await $`git show-ref`.cwd(repo.target).quiet()).text()).toBe(refs)
  expect((await $`git rev-parse HEAD`.cwd(repo.target).quiet()).text().trim()).toBe(repo.input.targetHead)
  expect((await $`git status --porcelain`.cwd(repo.target).quiet()).text()).toBe("")
  expect(await Bun.file(path.join(repo.target, "sum.ts")).exists()).toBe(false)
  expect((await $`git ls-tree -r --name-only ${candidate.head}`.cwd(repo.target).quiet()).text()).toContain("run.ts")
  await expect(
    applyIntegration({ ...repo.input, candidateHead: repo.input.targetHead }, repo.inventory),
  ).rejects.toThrow("candidate changed")
  const applied = await applyIntegration({ ...repo.input, candidateHead: candidate.head! }, repo.inventory)
  expect(applied.head).toBe(candidate.head)
  expect((await $`git rev-parse HEAD`.cwd(repo.target).quiet()).text().trim()).toBe(candidate.head)
  expect((await $`git status --porcelain`.cwd(repo.target).quiet()).text()).toBe("")
  for (const source of repo.input.sources)
    expect((await $`git rev-parse HEAD`.cwd(source.directory).quiet()).text().trim()).toBe(source.head)
}, 30_000)

test("reports exact conflict paths, skips later sources and leaves every checkout untouched", async () => {
  await using repo = await fixture()
  const name = process.platform === "win32" ? "shared file.txt" : "shared\tfile.txt"
  repo.input.sources[0]!.head = await change(repo.sources[0]!.directory, name, "first\n")
  repo.input.sources[1]!.head = await change(repo.sources[1]!.directory, name, "second\n")
  repo.input.sources.push(repo.sources[2]!)
  const candidate = await prepareIntegration(repo.input, repo.inventory)
  expect(candidate.status).toBe("conflicted")
  expect(candidate.head).toBeUndefined()
  expect(candidate.tree).toBeUndefined()
  expect(candidate.steps).toHaveLength(2)
  expect(candidate.steps[1]).toMatchObject({ status: "conflicted", conflicts: [name] })
  await expect(
    applyIntegration({ ...repo.input, candidateHead: repo.input.targetHead }, repo.inventory),
  ).rejects.toThrow("Resolve source conflicts")
  expect((await $`git rev-parse HEAD`.cwd(repo.target).quiet()).text().trim()).toBe(repo.input.targetHead)
  expect(await Bun.file(path.join(repo.target, name)).exists()).toBe(false)
  for (const directory of [repo.target, ...repo.sources.map((source) => source.directory)])
    expect((await $`git status --porcelain`.cwd(directory).quiet()).text()).toBe("")
}, 30_000)

test("requires a fresh review when a pinned source or target revision changes", async () => {
  await using repo = await fixture()
  repo.input.sources[0]!.head = await change(repo.sources[0]!.directory, "first.txt", "one\n")
  const candidate = await prepareIntegration(repo.input, repo.inventory)
  const updated = await change(repo.sources[0]!.directory, "first.txt", "two\n")
  await expect(applyIntegration({ ...repo.input, candidateHead: candidate.head! }, repo.inventory)).rejects.toThrow(
    "revision changed",
  )
  repo.input.sources[0]!.head = updated
  const current = await prepareIntegration(repo.input, repo.inventory)
  const targetHead = await change(repo.target, "target.txt", "target\n")
  await expect(applyIntegration({ ...repo.input, candidateHead: current.head! }, repo.inventory)).rejects.toThrow(
    "revision changed",
  )
  expect((await $`git rev-parse HEAD`.cwd(repo.target).quiet()).text().trim()).toBe(targetHead)
}, 30_000)

test("refuses dirty sources and targets without staging or replacing changes", async () => {
  await using repo = await fixture()
  repo.input.sources[0]!.head = await change(repo.sources[0]!.directory, "first.txt", "one\n")
  const candidate = await prepareIntegration(repo.input, repo.inventory)
  await Bun.write(path.join(repo.sources[1]!.directory, "uncommitted.txt"), "preserve source\n")
  await expect(prepareIntegration(repo.input, repo.inventory)).rejects.toThrow("Commit source changes")
  await fs.unlink(path.join(repo.sources[1]!.directory, "uncommitted.txt"))
  await Bun.write(path.join(repo.target, "first.txt"), "preserve target\n")
  await expect(applyIntegration({ ...repo.input, candidateHead: candidate.head! }, repo.inventory)).rejects.toThrow(
    "clean the integration target",
  )
  expect(await Bun.file(path.join(repo.target, "first.txt")).text()).toBe("preserve target\n")
  expect((await $`git diff --cached --name-only`.cwd(repo.target).quiet()).text()).toBe("")
}, 30_000)

test("refuses duplicate, unmanaged, identical and foreign source checkouts", async () => {
  await using repo = await fixture()
  await expect(
    prepareIntegration({ ...repo.input, sources: [repo.sources[0]!, repo.sources[0]!] }, repo.inventory),
  ).rejects.toThrow("only once")
  await expect(
    prepareIntegration(
      repo.input,
      repo.inventory.map((entry) => ({ directory: entry.directory })),
    ),
  ).rejects.toThrow("managed source")
  await expect(
    prepareIntegration(
      { ...repo.input, sources: [{ directory: repo.target, head: repo.input.targetHead }] },
      repo.inventory,
    ),
  ).rejects.toThrow("managed source")
  await expect(prepareIntegration(repo.input, repo.inventory.slice(0, 1))).rejects.toThrow("recorded inventory")
  const foreign = AbsolutePath.make(path.join(repo.path, "foreign"))
  await fs.mkdir(foreign)
  await initRepo(foreign)
  await expect(
    prepareIntegration({ ...repo.input, sources: [{ directory: foreign, head: repo.input.targetHead }] }, [
      ...repo.inventory,
      { directory: foreign, strategy: "git" },
    ]),
  ).rejects.toThrow("same Git repository")
}, 30_000)

test("resolves recorded checkout aliases without requiring unrelated missing inventory paths", async () => {
  await using repo = await fixture()
  const inventory = await Promise.all(
    repo.inventory.map(async (entry, index) => {
      const directory = AbsolutePath.make(path.join(repo.path, `recorded-${index}`))
      await fs.symlink(entry.directory, directory, process.platform === "win32" ? "junction" : "dir")
      return { ...entry, directory }
    }),
  )
  const candidate = await prepareIntegration(repo.input, [
    ...inventory,
    { directory: AbsolutePath.make(path.join(repo.path, "missing")), strategy: "git" },
  ])
  expect(candidate.status).toBe("ready")
  expect(candidate.target).toBe(repo.target)
  expect(candidate.sources).toEqual(repo.input.sources)
}, 30_000)

test("keeps already included results and handles three divergent sources", async () => {
  await using repo = await fixture()
  repo.input.sources = await Promise.all(
    repo.sources.map(async (source, index) => ({
      ...source,
      head: await change(source.directory, `${index}.txt`, `result ${index}\n`),
    })),
  )
  const candidate = await prepareIntegration(repo.input, repo.inventory)
  expect(candidate.steps.map((step) => step.status)).toEqual(["fast_forward", "merged", "merged"])
  expect(
    (await $`git ls-tree -r --name-only ${candidate.head}`.cwd(repo.target).quiet()).text().trim().split("\n"),
  ).toEqual(["0.txt", "1.txt", "2.txt"])
  await applyIntegration({ ...repo.input, candidateHead: candidate.head! }, repo.inventory)
  const included = await prepareIntegration({ ...repo.input, targetHead: candidate.head! }, repo.inventory)
  expect(included.steps.every((step) => step.status === "included")).toBe(true)
  expect(included.head).toBe(candidate.head)
  expect(included.diff).toBe("")
}, 30_000)

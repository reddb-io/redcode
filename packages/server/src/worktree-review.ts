import { realpath } from "node:fs/promises"
import { Worktree } from "@opencode/schema/worktree"
import { AbsolutePath } from "@opencode/schema/schema"
import { sameDirectory } from "@opencode/util/path"

const limits = { diff: 512_000 }
async function runGit(directory: string, args: string[], env?: Record<string, string>) {
  const process = Bun.spawn(["git", "-C", directory, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...Bun.env, ...env } } : {}),
  })
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { output, error, code }
}

async function git(directory: string, args: string[], env?: Record<string, string>) {
  const result = await runGit(directory, args, env)
  if (result.code !== 0) throw new Error(result.error.trim() || "Git operation failed")
  return result.output.trimEnd()
}

/** Inventory, canonical paths and Git common-dir all have to agree before changing a checkout. */
export async function inspectWorktree(input: Worktree.InspectInput, inventory: Worktree.List) {
  const [directory, target, recorded] = await Promise.all([
    realpath(input.directory),
    realpath(input.target),
    resolveWorktreeInventory(inventory),
  ])
  const source = recorded.find((item) => sameDirectory(item.directory, directory))
  if (!source || !recorded.some((item) => sameDirectory(item.directory, target)))
    throw new Error("Select checkouts from this project's recorded inventory")
  const common = await Promise.all(
    [directory, target].map(async (checkout) =>
      realpath(await git(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"])),
    ),
  )
  if (!sameDirectory(common[0]!, common[1]!)) throw new Error("Checkouts do not belong to the same Git repository")
  const [head, targetHead, branch, status, targetStatus] = await Promise.all([
    git(directory, ["rev-parse", "HEAD"]),
    git(target, ["rev-parse", "HEAD"]),
    git(directory, ["symbolic-ref", "--short", "HEAD"]).catch(() => null),
    git(directory, ["status", "--porcelain=v1"]),
    git(target, ["status", "--porcelain=v1"]),
  ])
  const base = await git(directory, ["merge-base", head, targetHead])
  const diff = await git(directory, ["diff", "--no-ext-diff", "--no-textconv", "--binary", base, "--"])
  return {
    directory: AbsolutePath.make(directory),
    target: AbsolutePath.make(target),
    head,
    targetHead,
    branch,
    status,
    dirty: Boolean(status),
    targetDirty: Boolean(targetStatus),
    diff: diff.slice(0, limits.diff),
    truncated: diff.length > limits.diff,
    managed: source.strategy === "git",
  }
}

export async function integrateWorktree(input: Worktree.IntegrateInput, inventory: Worktree.List) {
  const review = await inspectWorktree(input, inventory)
  if (!review.managed || sameDirectory(review.directory, review.target))
    throw new Error("Select a managed source worktree and a different integration target")
  if (review.dirty || review.targetDirty)
    throw new Error("Commit source changes and clean the integration target before integrating")
  if (review.head !== input.head || review.targetHead !== input.targetHead)
    throw new Error("The reviewed revision changed. Review again before integrating")
  // Refuse divergent histories. A failed fast-forward leaves the target and source intact.
  await git(review.target, ["merge", "--ff-only", review.head])
  return inspectWorktree(input, inventory)
}

/** Build a reproducible merge commit without moving a ref, staging files or starting a checkout merge. */
export async function prepareIntegration(
  input: Worktree.PrepareIntegrationInput,
  inventory: Worktree.List,
): Promise<Worktree.IntegrationCandidate> {
  const sources = await integrationSources(input, inventory)
  const target = sources[0]!.target
  const prepared = await sources.reduce(
    async (pending, source) => {
      const result = await pending
      if (result.conflicted) return result
      const included = await runGit(target, ["merge-base", "--is-ancestor", source.head, result.head])
      if (![0, 1].includes(included.code)) throw new Error(included.error.trim() || "Could not inspect Git ancestry")
      if (included.code === 0)
        return {
          ...result,
          steps: [
            ...result.steps,
            { directory: source.directory, head: source.head, status: "included" as const, conflicts: [] },
          ],
        }
      const forward = await runGit(target, ["merge-base", "--is-ancestor", result.head, source.head])
      if (![0, 1].includes(forward.code)) throw new Error(forward.error.trim() || "Could not inspect Git ancestry")
      if (forward.code === 0)
        return {
          ...result,
          head: source.head,
          steps: [
            ...result.steps,
            { directory: source.directory, head: source.head, status: "fast_forward" as const, conflicts: [] },
          ],
        }
      const merged = await runGit(target, [
        "merge-tree",
        "--write-tree",
        "--name-only",
        "-z",
        "--no-messages",
        result.head,
        source.head,
      ])
      if (![0, 1].includes(merged.code)) throw new Error(merged.error.trim() || "Could not prepare Git merge")
      const [tree, ...paths] = merged.output.split("\0")
      if (merged.code === 1)
        return {
          ...result,
          conflicted: true,
          steps: [
            ...result.steps,
            {
              directory: source.directory,
              head: source.head,
              status: "conflicted" as const,
              conflicts: paths.filter(Boolean),
            },
          ],
        }
      // Parent-derived time and a fixed identity make the reviewed commit reproducible on application.
      const timestamps = await Promise.all(
        [result.head, source.head].map((head) => git(target, ["show", "-s", "--format=%ct", head])),
      )
      const date = `${Math.max(...timestamps.map(Number)) + 1} +0000`
      const head = await git(
        target,
        [
          "commit-tree",
          tree!,
          "-p",
          result.head,
          "-p",
          source.head,
          "-m",
          "Merge delegated work for Redcode integration",
        ],
        {
          GIT_AUTHOR_NAME: "Redcode Integration",
          GIT_AUTHOR_EMAIL: "integration@redcode.local",
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_NAME: "Redcode Integration",
          GIT_COMMITTER_EMAIL: "integration@redcode.local",
          GIT_COMMITTER_DATE: date,
        },
      )
      return {
        ...result,
        head,
        steps: [
          ...result.steps,
          { directory: source.directory, head: source.head, status: "merged" as const, conflicts: [] },
        ],
      }
    },
    Promise.resolve({ head: input.targetHead, conflicted: false, steps: [] as Worktree.IntegrationCandidate["steps"] }),
  )
  // Object preparation can take time. Do not return an apparently current preview after a checkout moved.
  await integrationSources(input, inventory)
  const diff = prepared.conflicted
    ? ""
    : await git(target, ["diff", "--no-ext-diff", "--no-textconv", "--binary", input.targetHead, prepared.head, "--"])
  return {
    projectID: input.projectID,
    target,
    targetHead: input.targetHead,
    sources: sources.map((source) => ({ directory: source.directory, head: source.head })),
    status: prepared.conflicted ? "conflicted" : "ready",
    ...(!prepared.conflicted
      ? { head: prepared.head, tree: await git(target, ["rev-parse", `${prepared.head}^{tree}`]) }
      : {}),
    steps: prepared.steps,
    diff: diff.slice(0, limits.diff),
    truncated: diff.length > limits.diff,
  }
}

/** Apply exactly the reviewed combination; no conflict resolution or acceptance is implied. */
export async function applyIntegration(input: Worktree.ApplyIntegrationInput, inventory: Worktree.List) {
  const candidate = await prepareIntegration(input, inventory)
  if (candidate.status !== "ready") throw new Error("Resolve source conflicts and prepare the integration again")
  if (candidate.head !== input.candidateHead)
    throw new Error("The integration candidate changed. Review and verify the combined revision again")
  await git(candidate.target, ["merge", "--ff-only", candidate.head])
  return candidate
}

async function integrationSources(input: Worktree.PrepareIntegrationInput, inventory: Worktree.List) {
  const sources = await Promise.all(
    input.sources.map((source) =>
      inspectWorktree(
        {
          projectID: input.projectID,
          directory: source.directory,
          target: input.target,
        },
        inventory,
      ),
    ),
  )
  if (sources.some((source) => !source.managed || sameDirectory(source.directory, source.target)))
    throw new Error("Select managed source worktrees and a different integration target")
  if (new Set(sources.map((source) => source.directory)).size !== sources.length)
    throw new Error("Select each source worktree only once")
  if (sources.some((source) => source.dirty || source.targetDirty))
    throw new Error("Commit source changes and clean the integration target before preparing integration")
  if (
    sources.some(
      (source, index) => source.head !== input.sources[index]!.head || source.targetHead !== input.targetHead,
    )
  )
    throw new Error("The reviewed revision changed. Review again before integrating")
  return sources
}

export async function checkpointWorktree(input: Worktree.CheckpointInput, inventory: Worktree.List) {
  const [directory, recorded] = await Promise.all([realpath(input.directory), resolveWorktreeInventory(inventory)])
  if (!recorded.some((item) => sameDirectory(item.directory, directory) && item.strategy === "git"))
    throw new Error("Only a recorded managed Git worktree can be checkpointed")
  if (!(await git(directory, ["status", "--porcelain=v1"]))) return git(directory, ["rev-parse", "HEAD"])
  await git(directory, ["add", "--all", "--", "."])
  await git(directory, ["commit", "-m", input.message])
  return git(directory, ["rev-parse", "HEAD"])
}

/** Keep a durable Git ref before removing a detached worktree; commits must remain reachable. */
export async function archiveWorktree(
  input: Worktree.ArchiveInput,
  inventory: Worktree.List,
): Promise<Worktree.Archive> {
  const [directory, recorded] = await Promise.all([realpath(input.directory), resolveWorktreeInventory(inventory)])
  if (!recorded.some((item) => sameDirectory(item.directory, directory) && item.strategy === "git"))
    throw new Error("Only a managed Git worktree can be archived")
  const head = await git(directory, ["rev-parse", "HEAD"])
  if (head !== input.head) throw new Error("The reviewed revision changed. Review again before archive")
  if (await git(directory, ["status", "--porcelain=v1"])) throw new Error("Commit non-ignored changes before archive")
  const stamp = Date.now()
  const reference = `refs/redcode/archives/${stamp}-${crypto.randomUUID()}`
  await git(directory, ["update-ref", reference, head, ""])
  return { reference, head, createdAt: new Date(stamp).toISOString() }
}

/** Resolve both sides through the same API: Windows callback paths can contain short-name aliases. */
export async function resolveWorktreeInventory(inventory: Worktree.List) {
  return (
    await Promise.all(
      inventory.map(async (item) => {
        // Saved inventory also contains unavailable checkouts; they cannot authorize an operation.
        const directory = await realpath(item.directory).catch(() => undefined)
        return directory === undefined ? undefined : { ...item, directory: AbsolutePath.make(directory) }
      }),
    )
  ).filter((item) => item !== undefined)
}

export async function worktreeArchives(inventory: Worktree.List): Promise<Worktree.Archive[]> {
  const root = inventory.find((item) => !item.strategy)
  if (!root) throw new Error("Repository checkout is unavailable")
  const lines = await git(root.directory, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/redcode/archives/",
  ])
  return lines
    .split("\n")
    .flatMap((line) => {
      const [reference, head] = line.split(" ")
      const timestamp = Number(reference?.split("/").at(-1)?.split("-")[0])
      return reference && head && Number.isFinite(timestamp)
        ? [{ reference, head, createdAt: new Date(timestamp).toISOString() }]
        : []
    })
    .toReversed()
}

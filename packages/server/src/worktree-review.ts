import { realpath } from "node:fs/promises"
import { Worktree } from "@opencode/schema/worktree"
import { AbsolutePath } from "@opencode/schema/schema"

const limits = { diff: 512_000 }
async function git(directory: string, args: string[]) {
  const process = Bun.spawn(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw new Error(error.trim() || "Git operation failed")
  return output.trimEnd()
}

/** Inventory, canonical paths and Git common-dir all have to agree before changing a checkout. */
export async function inspectWorktree(input: Worktree.InspectInput, inventory: Worktree.List) {
  const [directory, target] = await Promise.all([realpath(input.directory), realpath(input.target)])
  const source = inventory.find((item) => item.directory === directory)
  if (!source || !inventory.some((item) => item.directory === target))
    throw new Error("Select checkouts from this project's recorded inventory")
  const common = await Promise.all([
    git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(target, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ])
  if (common[0] !== common[1]) throw new Error("Checkouts do not belong to the same Git repository")
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
  if (!review.managed || review.directory === review.target)
    throw new Error("Select a managed source worktree and a different integration target")
  if (review.dirty || review.targetDirty)
    throw new Error("Commit source changes and clean the integration target before integrating")
  if (review.head !== input.head || review.targetHead !== input.targetHead)
    throw new Error("The reviewed revision changed. Review again before integrating")
  // Refuse divergent histories. A failed fast-forward leaves the target and source intact.
  await git(review.target, ["merge", "--ff-only", review.head])
  return inspectWorktree(input, inventory)
}

export async function checkpointWorktree(input: Worktree.CheckpointInput, inventory: Worktree.List) {
  const directory = await realpath(input.directory)
  if (!inventory.some((item) => item.directory === directory && item.strategy === "git"))
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
  const directory = await realpath(input.directory)
  if (!inventory.some((item) => item.directory === directory && item.strategy === "git"))
    throw new Error("Only a managed Git worktree can be archived")
  const head = await git(directory, ["rev-parse", "HEAD"])
  if (head !== input.head) throw new Error("The reviewed revision changed. Review again before archive")
  if (await git(directory, ["status", "--porcelain=v1"])) throw new Error("Commit non-ignored changes before archive")
  const stamp = Date.now()
  const reference = `refs/redcode/archives/${stamp}-${crypto.randomUUID()}`
  await git(directory, ["update-ref", reference, head, ""])
  return { reference, head, createdAt: new Date(stamp).toISOString() }
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

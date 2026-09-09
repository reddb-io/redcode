export * as RepositoryGuard from "./repository-guard"

import path from "node:path"
import { lstat, realpath, mkdir } from "node:fs/promises"
import { Effect, Schema } from "effect"

export const FORBIDDEN = [
  "reset",
  "stash",
  "clean",
  "restore",
  "checkout",
  "read-tree",
  "checkout-index",
  "update-ref",
] as const

export const INSTRUCTIONS = `Repository preflight is mandatory before coding, without waiting for a user reminder. Call worktree_prepare automatically and use the returned task directory:
1. Inspect the repository root, branch, git status --short and git worktree list --porcelain. Preserve existing tracked and untracked work.
2. In a Git repository, perform all source creation, editing, deletion, builds and tests in a separate linked worktree. A new branch in the primary checkout is insufficient. Reuse the current linked worktree only when it belongs to this task; otherwise create a uniquely named branch/worktree outside the source checkout with git worktree add -b <branch> <absolute-directory> HEAD. Never stash, reset or clean to make room. An unborn repository needs an initial user-owned commit before a worktree can be created.
3. Verify the worktree root and branch and compare git rev-parse --git-dir with git rev-parse --git-common-dir. Read the worktree's instructions and files before editing. Use absolute worktree paths for file tools and workdir; shell calls do not change the session directory. Keep subsequent edits, tests and commits in that same worktree. Record these checks in the task checklist before the first edit.
4. The harness blocks git ${FORBIDDEN.join(", git ")}, forced/deleting pushes, forced branch changes/deletions, discard switches, and worktree removal/pruning. Do not bypass the policy through aliases, wrappers, scripts, another tool or equivalent filesystem operations. Report a blocked operation and use a preserving alternative.
5. Recheck status and diff before delivery. Retain the worktree and all unrelated work. A non-Git directory does not require a worktree. Harness-owned session records and caches are not source edits.`

export class Violation extends Schema.TaggedErrorClass<Violation>()("RepositoryGuard.Violation", {
  message: Schema.String,
}) {}

export const yolo = () => process.env.REDCODE_YOLO === "1"
export const instructions = () =>
  yolo()
    ? "YOLO mode is active: repository restrictions, mandatory worktrees and permission filters are disabled for this local harness process. Follow the user's requested working directory and operations."
    : INSTRUCTIONS

const missing = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
  throw error
}

/** Find the real existing ancestor, including symlinks, before checking Git placement. */
export async function inspect(target: string) {
  let directory = path.resolve(target)
  for (;;) {
    const resolved = await realpath(directory).catch(missing)
    if (resolved) {
      directory = (await lstat(resolved)).isDirectory() ? resolved : path.dirname(resolved)
      break
    }
    const parent = path.dirname(directory)
    if (parent === directory) return
    directory = parent
  }
  for (;;) {
    if (await lstat(path.join(directory, ".git")).catch(missing)) {
      const proc = Bun.spawn(
        [
          "git",
          "-C",
          directory,
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-dir",
          "--git-common-dir",
        ],
        {
          env: {
            ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
            GIT_OPTIONAL_LOCKS: "0",
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const [output, error, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (exit !== 0)
        throw new Violation({ message: `Cannot verify repository placement at ${directory}: ${error.slice(0, 400)}` })
      const lines = output
        .trimEnd()
        .split("\n")
        .map((line) => line.replace(/\r$/, ""))
      if (lines.length !== 3)
        throw new Violation({ message: "Git returned incomplete repository placement; source writes are blocked." })
      const [root, gitDirectory, commonDirectory] = await Promise.all(lines.map((line) => realpath(line)))
      return { root, gitDirectory, commonDirectory, linked: gitDirectory !== commonDirectory }
    }
    const parent = path.dirname(directory)
    if (parent === directory) return
    directory = parent
  }
}

const within = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
}

async function writable(target: string) {
  if (yolo()) return
  const repository = await inspect(target)
  if (!repository) return
  if (!repository.linked)
    throw new Violation({
      message: `Source edits are blocked in the primary Git checkout: ${repository.root}. Complete the repository preflight and create a separate linked worktree with git worktree add -b <branch> <absolute-directory> HEAD. Read and edit the worktree copy; existing changes have been preserved.`,
    })
  if (within(path.join(repository.root, ".git"), path.resolve(target)))
    throw new Violation({
      message: "Direct edits to Git metadata are prohibited. Use preserving Git operations in the task worktree.",
    })
}

const tokens = (command: string) =>
  (command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) ?? []).map((token) => token.replace(/^(['"])(.*)\1$/, "$2"))

/** Conservative command guard, not a sandbox for arbitrary interpreter/script execution. */
export function forbidden(command: string) {
  const normalized = command.replace(/\\\r?\n/g, "").replace(/['"`\\]/g, "")
  if (/\bGIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE)\s*=/i.test(normalized)) return "Git directory/index overrides"
  for (const match of normalized.matchAll(/(?:^|[\s;&|()])(?:[^\s;&|()]*\/)??git(?:\.exe)?\s+([^;&|\n]+)/gi)) {
    const args = match[1].trim().split(/\s+/)
    let index = 0
    while (args[index]?.startsWith("-")) {
      const option = args[index++]
      if (/^--(?:git-dir|work-tree)(?:=|$)/.test(option)) return "Git directory overrides"
      if (["-C", "-c"].includes(option)) index++
    }
    const name = args[index]?.toLowerCase()
    const rest = args.slice(index + 1)
    if (FORBIDDEN.some((item) => item === name)) return `git ${name}`
    if (
      name === "push" &&
      rest.some(
        (arg) =>
          /^--(?:force|mirror|delete)/.test(arg) ||
          /^-[^-]*[fd]/.test(arg) ||
          arg.startsWith("+") ||
          arg.startsWith(":"),
      )
    )
      return "forced or deleting git push"
    if (name === "branch" && rest.some((arg) => /^--(?:delete|force|move)/.test(arg) || /^-[^-]*[dDfMm]/.test(arg)))
      return "branch deletion or forced replacement"
    if (name === "switch" && rest.some((arg) => ["-f", "-C", "--discard-changes", "--force-create"].includes(arg)))
      return "discarding git switch"
    if (name === "worktree" && rest.some((arg) => ["remove", "prune", "--force", "-f", "-B"].includes(arg)))
      return "destructive git worktree operation"
    if (name === "reflog" && rest.includes("expire")) return "git reflog expire"
  }
}

function primaryAllowed(command: string) {
  if (/[;&|<>$`()\r\n]/.test(command)) return false
  const args = tokens(command)
  if (["pwd", "ls", "cat", "head", "tail", "wc"].includes(args[0])) return true
  if (args[0] === "rg") return !args.some((arg) => arg.startsWith("--pre"))
  if (args[0] !== "git") return false
  if (args.some((arg) => /^--(?:output|ext-diff|textconv|exec-path|paginate)/.test(arg))) return false
  let index = 1
  while (args[index] === "-C" || args[index] === "--no-pager") {
    if (args[index] === "-C" && !args[index + 1]) return false
    index += args[index] === "-C" ? 2 : 1
  }
  return (
    ["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree", "push"].includes(args[index]) ||
    (args[index] === "branch" && args[index + 1] === "--show-current") ||
    (args[index] === "worktree" && args[index + 1] === "list")
  )
}

async function shell(directory: string, command: string) {
  if (yolo()) return
  const blocked = forbidden(command)
  if (blocked)
    throw new Violation({
      message: `Repository policy prohibits ${blocked}. No command was executed. Preserve existing work; do not retry through another spelling, alias or tool.`,
    })
  const repository = await inspect(directory)
  const args = tokens(command)
  if (repository && !repository.linked && !primaryAllowed(command)) {
    const setup =
      args[0] === "git" &&
      args[1] === "worktree" &&
      args[2] === "add" &&
      args[3] === "-b" &&
      args.length >= 6 &&
      args.length <= 7 &&
      !args[4].startsWith("-") &&
      path.isAbsolute(args[5]) &&
      !/[;&|<>$`()\r\n]/.test(command)
    if (setup) {
      const target = await inspect(args[5])
      if (!within(repository.root, path.resolve(args[5])) && !target) return
    }
    throw new Violation({
      message: `Run this command in a separate linked worktree, not the primary Git checkout ${repository.root}. First inspect status and worktrees with separate read-only commands, then run git worktree add -b <branch> <absolute-directory-outside-repository> HEAD. Set workdir to the new absolute path. No command was executed.`,
    })
  }
  if (primaryAllowed(command)) return
  for (const arg of args) {
    if (path.isAbsolute(arg) || arg.startsWith("../") || arg.startsWith("./"))
      await writable(path.resolve(directory, arg))
  }
}

const failure = (error: unknown) =>
  error instanceof Violation
    ? error
    : new Violation({
        message: `Repository preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      })
export const assertWrite = (target: string) => Effect.tryPromise({ try: () => writable(target), catch: failure })
export const assertShell = (directory: string, command: string) =>
  Effect.tryPromise({ try: () => shell(directory, command), catch: failure })

export const worktreePattern = (root: string) =>
  path.join(path.dirname(root), ".redcode-worktrees", path.basename(root), "*")
export const prototypePatterns = (root: string) => [
  path.join(worktreePattern(root), ".red/code/design/*/work/*"),
  path.join(worktreePattern(root), "*/.red/code/design/*/work/*"),
]
export const planPatterns = (root: string) => [
  path.join(worktreePattern(root), ".red/code/plans/*.md"),
  path.join(worktreePattern(root), "*/.red/code/plans/*.md"),
]

/** Artifact producers keep their session placement but author source in a linked worktree. */
const preparing = new Map<string, Promise<string>>()

export function prepare(directory: string, task?: string) {
  const key = `${directory}\0${task ?? ""}`
  const existing = preparing.get(key)
  if (existing) return existing
  const result = prepareWorktree(directory, task).finally(() => preparing.delete(key))
  preparing.set(key, result)
  return result
}

async function prepareWorktree(directory: string, task?: string) {
  if (yolo()) return directory
  const repository = await inspect(directory)
  if (!repository || repository.linked) return directory
  const branch = `redcode-${task ? new Bun.CryptoHasher("sha256").update(task).digest("hex").slice(0, 16) : crypto.randomUUID().slice(0, 8)}`
  const target = path.join(path.dirname(worktreePattern(repository.root)), branch)
  if (task && (await lstat(target).catch(missing))) {
    const existing = await inspect(target)
    if (
      !existing?.linked ||
      existing.root !== (await realpath(target)) ||
      existing.commonDirectory !== repository.commonDirectory
    )
      throw new Violation({
        message: "The task worktree path is occupied by a different workspace; existing material has been preserved.",
      })
    return path.join(target, path.relative(repository.root, directory))
  }
  if (await inspect(target))
    throw new Violation({ message: "The managed worktree directory must be outside every source checkout." })
  await mkdir(path.dirname(target), { recursive: true })
  const proc = Bun.spawn(["git", "-C", repository.root, "worktree", "add", "-b", branch, target, "HEAD"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
  })
  const [, error, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0)
    throw new Violation({
      message: `Cannot prepare a task worktree; source checkout is unchanged. ${error.slice(0, 400)}`,
    })
  if (!(await inspect(target))?.linked)
    throw new Violation({ message: "Created directory is not a linked worktree; source edits remain blocked." })
  return path.join(target, path.relative(repository.root, directory))
}

export async function preflight(directory: string, task: string, plan?: string) {
  const workspace = await prepare(directory, task)
  const repository = await inspect(workspace)
  if (!repository) return `Non-Git directory: ${workspace}. No worktree required.`
  const status = await repositoryStatus(repository.root)
  const source = workspace !== directory ? await repositoryStatus(directory) : undefined
  return [
    `Repository preflight: ${yolo() ? "YOLO; restrictions disabled" : "linked worktree verified"}`,
    `Task directory: ${workspace}`,
    `Repository root: ${repository.root}`,
    `Git directory: ${repository.gitDirectory}`,
    `Common directory: ${repository.commonDirectory}`,
    `Task status:\n${status}`,
    `Plan path: ${plan ?? path.join(workspace, ".red", "code", "plans", task + ".md")}`,
    ...(workspace !== directory
      ? [
          `Source status:\n${source}`,
          `The source checkout ${directory} is unchanged. The task starts from HEAD; inspect relevant uncommitted source changes before copying any into this worktree.`,
        ]
      : []),
    "Read this worktree's instructions and files before editing. Use its absolute paths for file tools and workdir for commands. Record the preflight in the task checklist.",
  ].join("\n")
}

async function repositoryStatus(directory: string) {
  const proc = Bun.spawn(["git", "-C", directory, "status", "--short", "--branch"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
      GIT_OPTIONAL_LOCKS: "0",
    },
  })
  const [status, error, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0) throw new Violation({ message: `Cannot verify repository status: ${error.slice(0, 400)}` })
  return `${status.slice(0, 6000)}${status.length > 6000 ? "\n(status truncated; inspect remaining entries)" : ""}`
}

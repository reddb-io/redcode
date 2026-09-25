export * as RepositoryGuard from "./repository-guard"

import path from "node:path"
import { lstat, realpath, mkdir, readdir } from "node:fs/promises"
import { Effect, Schema } from "effect"

/** Session worktrees live inside the primary checkout, hidden from it through `info/exclude`. */
export const WORKTREES = ".red/worktrees"

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

export const INSTRUCTIONS = `Repository placement is handled by the harness. Follow these rules without waiting for a user reminder:
1. Reading, searching and answering questions happen wherever the session is; they never create a worktree.
2. In a Git repository, the first source creation, edit, deletion or build/test command that the session makes in the primary checkout makes the harness create a linked worktree at <repository root>/${WORKTREES}/<name> on a new branch <name>, based on the current HEAD, and move the session into it. The edit or command then runs against the same relative path inside that worktree, and the tool result reports it. Existing tracked and untracked work in the primary checkout is never stashed, reset or cleaned; the new worktree starts from HEAD, so inspect relevant uncommitted primary changes before copying any over.
3. After the move, use the worktree's absolute paths for file tools and workdir; keep subsequent edits, tests and commits in that same worktree. Do not create another worktree by hand. worktree_prepare is optional: it creates or reuses the same session worktree early and reports its root, branch and status. Subagents inherit the session's worktree.
4. The harness blocks git ${FORBIDDEN.join(", git ")}, forced/deleting pushes, forced branch changes/deletions, discard switches, and worktree removal/pruning. Do not bypass the policy through aliases, wrappers, scripts, another tool or equivalent filesystem operations. Report a blocked operation and use a preserving alternative.
5. Recheck status and diff before delivery. Retain the worktree and all unrelated work. A non-Git directory does not require a worktree. An unborn repository needs an initial user-owned commit before a worktree can be created. Harness-owned session records and caches are not source edits.`

export class Violation extends Schema.TaggedErrorClass<Violation>()("RepositoryGuard.Violation", {
  message: Schema.String,
}) {}

export const YOLO_INSTRUCTIONS = `YOLO mode is active: permission prompts, permission filters and the Git command policy are disabled for this local harness process. Work isolation still applies:
1. Reading, searching and answering questions happen wherever the session is; they never create a worktree.
2. In a Git repository, the first source creation, edit, deletion or non-read-only command that a writing session makes in the primary checkout makes the harness create a linked worktree at <repository root>/${WORKTREES}/<name> on a new branch <name>, based on the current HEAD, and move the session into it. The edit or command then runs against the same relative path inside that worktree, and the tool result reports it. Uncommitted work in the primary checkout stays there; the new worktree starts from HEAD.
3. After the move, use the worktree's absolute paths for file tools and workdir; keep subsequent edits, tests and commits in that same worktree. Subagents inherit the session's worktree.`

/** YOLO skips permission prompts and the Git command policy; it does not stop writing sessions from getting a worktree. */
export const yolo = () => process.env.REDCODE_YOLO === "1"
/** `REDCODE_AUTO_WORKTREE=0` keeps writing sessions in the primary checkout, in every mode. */
export const auto = () => process.env.REDCODE_AUTO_WORKTREE !== "0"
export const instructions = () => {
  if (!yolo()) return INSTRUCTIONS
  if (auto()) return YOLO_INSTRUCTIONS
  return "YOLO mode is active: repository restrictions, automatic worktrees and permission filters are disabled for this local harness process. Follow the user's requested working directory and operations."
}

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
      message: `Source edits are blocked in the primary Git checkout: ${repository.root}. The harness moves the session into its own worktree under ${WORKTREES} on the first edit; call worktree_prepare to create it now, then edit the worktree copy. Existing changes have been preserved.`,
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

/** Output filters a read-only primary command may pipe into. */
const FILTERS = ["head", "tail", "wc", "sort", "grep", "cut", "tr", "cat"]

/** Whether a command only reads the primary checkout, so it runs there without a session worktree. */
export function readOnly(command: string) {
  if (/[;&<>$`()\r\n]|\|\|/.test(command)) return false
  const [first, ...rest] = command.split("|")
  return (
    primaryAllowed(first.trim()) &&
    rest.every((segment) => {
      const args = tokens(segment.trim())
      return FILTERS.includes(args[0]) && !(args[0] === "sort" && args.some((arg) => /^-[^-]*o|^--output/.test(arg)))
    })
  )
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
  if (repository && !repository.linked && !readOnly(command)) {
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
  if (readOnly(command)) return
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
  const branch = task ? taskBranch(task) : `redcode-${crypto.randomUUID().slice(0, 8)}`
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

const taskBranch = (task: string) => `redcode-${new Bun.CryptoHasher("sha256").update(task).digest("hex").slice(0, 16)}`

/** A session's linked worktree inside the primary checkout it was created from. */
export type Claim = {
  /** Root of the primary checkout. */
  readonly root: string
  /** Root of the session's linked worktree. */
  readonly worktree: string
  readonly branch: string
  readonly created: boolean
}

/** File in a linked worktree's Git directory naming the session that owns it. */
const OWNER = "redcode-session"

const STOPWORDS = new Set([
  ...["a", "an", "the", "to", "of", "for", "in", "on", "at", "by", "with", "and", "or", "into", "from", "about"],
  ...["please", "can", "could", "would", "should", "will", "you", "i", "me", "my", "we", "us", "our", "it", "its"],
  ...["this", "that", "these", "those", "is", "are", "be", "do", "does", "let", "lets", "some", "just", "so", "now"],
  ...["hey", "hi", "how", "what", "why", "need", "want"],
  // Portuguese and Spanish function words.
  ...["o", "os", "as", "um", "uma", "de", "da", "das", "dos", "e", "em", "no", "na", "nos", "nas", "para", "por"],
  ...["com", "que", "se", "eu", "voce", "el", "la", "los", "las", "y", "en", "con", "un", "una", "del", "al", "lo"],
])

/** Latin letters that Unicode decomposition does not reduce to ASCII. */
const LETTERS: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", ł: "l", þ: "th", ı: "i" }

/** Up to three kebab-case ASCII words naming a session worktree and its branch; "task" when none survive. */
export function slug(text: string) {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßæœøđðłþı]/g, (letter) => LETTERS[letter] ?? "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const meaningful = words.filter((word) => !STOPWORDS.has(word))
  return (
    (meaningful.length > 0 ? meaningful : words)
      .slice(0, 3)
      .map((word) => word.slice(0, 20))
      .join("-") || "task"
  )
}

/** The first of `name`, `name-2`, `name-3`, … that no branch or worktree directory already uses. */
export function nextName(name: string, taken: ReadonlySet<string>) {
  if (!taken.has(name)) return name
  for (let index = 2; ; index++) if (!taken.has(`${name}-${index}`)) return `${name}-${index}`
}

const claiming = new Map<string, Promise<Claim | undefined>>()

/**
 * Creates or reuses the session's worktree at `<primary root>/.red/worktrees/<slug>` on branch `<slug>`,
 * based on the primary checkout's HEAD. From inside the session's own worktree it returns that worktree.
 * YOLO mode gets one too. Returns nothing when `REDCODE_AUTO_WORKTREE=0`, outside Git, from any other
 * linked worktree, or for an unborn repository in YOLO mode. The primary checkout is never stashed,
 * reset or cleaned.
 */
export function claim(input: { directory: string; session: string; name: string }) {
  const key = `${input.directory}\0${input.session}`
  const existing = claiming.get(key)
  if (existing) return existing
  const result = claimWorktree(input).finally(() => claiming.delete(key))
  claiming.set(key, result)
  return result
}

async function claimWorktree(input: { directory: string; session: string; name: string }): Promise<Claim | undefined> {
  if (!auto()) return
  const repository = await inspect(input.directory)
  if (!repository) return
  if (repository.linked) return adopted(repository, input.session)
  // Without a first commit there is nothing to branch from. Outside YOLO the guard keeps refusing
  // source edits; YOLO lets them land in the primary checkout rather than leave the session unable to write.
  if (yolo() && (await git(repository.root, ["rev-parse", "--verify", "--quiet", "HEAD"])).exit !== 0) return
  await exclude(repository.commonDirectory)
  const base = path.join(repository.root, WORKTREES)
  const entries = await readdir(base).catch(() => [] as string[])
  const owners = await Promise.all(entries.map((entry) => owner(path.join(base, entry))))
  const owned = entries.find((_, index) => owners[index] === input.session)
  if (owned)
    return { root: repository.root, worktree: await realpath(path.join(base, owned)), branch: owned, created: false }
  const prepared = await preparedWorktree(repository, input.session)
  if (prepared) return prepared
  const branches = await git(repository.root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  const branch = nextName(
    slug(input.name),
    new Set([...entries, ...branches.output.split("\n").map((line) => line.trim())]),
  )
  const target = path.join(base, branch)
  await mkdir(base, { recursive: true })
  const created = await git(repository.root, ["worktree", "add", "-b", branch, target, "HEAD"])
  if (created.exit !== 0)
    throw new Violation({
      message: `Cannot create the session worktree ${WORKTREES}/${branch}: ${created.error.slice(0, 400).trim()} Source edits stay blocked in the primary checkout ${repository.root}, which is unchanged.`,
    })
  const worktree = await inspect(target)
  if (!worktree?.linked)
    throw new Violation({ message: "Created directory is not a linked worktree; source edits remain blocked." })
  await Bun.write(path.join(worktree.gitDirectory, OWNER), input.session)
  return { root: repository.root, worktree: worktree.root, branch, created: true }
}

/** A session already working in its own worktree keeps it, so stale primary paths still map into it. */
async function adopted(repository: { root: string; commonDirectory: string }, session: string) {
  if (path.basename(repository.commonDirectory) !== ".git") return
  if ((await owner(repository.root)) !== session) return
  const root = path.dirname(repository.commonDirectory)
  return { root, worktree: repository.root, branch: path.basename(repository.root), created: false }
}

/** A worktree `worktree_prepare` already made for this session outside the checkout keeps serving it. */
async function preparedWorktree(repository: { root: string; commonDirectory: string }, session: string) {
  const branch = taskBranch(session)
  const target = path.join(path.dirname(worktreePattern(repository.root)), branch)
  if (!(await lstat(target).catch(() => undefined))) return
  const existing = await inspect(target).catch(() => undefined)
  if (!existing?.linked || existing.commonDirectory !== repository.commonDirectory) return
  if (existing.root !== (await realpath(target))) return
  return { root: repository.root, worktree: existing.root, branch, created: false }
}

async function owner(worktree: string) {
  const pointer = await Bun.file(path.join(worktree, ".git"))
    .text()
    .catch(() => "")
  const gitdir = pointer.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  if (!gitdir) return
  return (
    await Bun.file(path.join(path.resolve(worktree, gitdir), OWNER))
      .text()
      .catch(() => "")
  ).trim()
}

/** Keeps nested session worktrees out of the primary checkout's status without touching `.gitignore`. */
async function exclude(commonDirectory: string) {
  const file = path.join(commonDirectory, "info", "exclude")
  const current = await Bun.file(file)
    .text()
    .catch(() => "")
  if (current.split(/\r?\n/).some((line) => [`/${WORKTREES}/`, `${WORKTREES}/`].includes(line.trim()))) return
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}/${WORKTREES}/\n`)
}

/**
 * The same path inside the session worktree for a target in its primary checkout. Targets elsewhere,
 * in Git metadata or already under a session worktree are returned unchanged.
 */
export async function relocate(claim: Claim, target: string) {
  const resolved = await canonical(target)
  if (
    !within(claim.root, resolved) ||
    within(path.join(claim.root, ".git"), resolved) ||
    within(path.join(claim.root, WORKTREES), resolved)
  )
    return target
  return path.join(claim.worktree, path.relative(claim.root, resolved))
}

/** The real path of the nearest existing ancestor, followed by the parts that do not exist yet. */
async function canonical(target: string) {
  const rest: string[] = []
  let current = path.resolve(target)
  for (;;) {
    const resolved = await realpath(current).catch(() => undefined)
    if (resolved) return path.join(resolved, ...rest)
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(target)
    rest.unshift(path.basename(current))
    current = parent
  }
}

async function git(directory: string, args: string[]) {
  const proc = Bun.spawn(["git", "-C", directory, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
  })
  const [output, error, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { output, error, exit }
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

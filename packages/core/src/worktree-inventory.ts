export * as WorktreeInventory from "./worktree-inventory"

import path from "node:path"
import { lstat, readdir, realpath, stat } from "node:fs/promises"
import { Schema } from "effect"
import { RepositoryGuard } from "./repository-guard"

/**
 * The repository's linked worktrees with what deciding to keep or remove one needs: size, pending
 * changes, divergence from the default branch, whether its branch already landed, and recent activity.
 * Removal never discards uncommitted work without an explicit `force`, and never touches the primary
 * checkout or a protected (current) worktree.
 */

export const Changes = Schema.Struct({
  tracked: Schema.Finite,
  untracked: Schema.Finite,
}).annotate({ identifier: "WorktreeInventoryChanges" })

export const Session = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).annotate({ identifier: "WorktreeInventorySession" })

export const Info = Schema.Struct({
  /** Absolute path of the worktree root. */
  path: Schema.String,
  /** The path relative to the primary checkout when the worktree is nested under it, e.g. `.red/worktrees/x`. */
  relative: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.String,
  primary: Schema.Boolean,
  /** Contains the requesting directory or a protected one; never removed. */
  current: Schema.Boolean,
  locked: Schema.Boolean,
  /** Registered but its directory is gone; `clean` prunes it. */
  prunable: Schema.Boolean,
  /** Bytes on disk, a lower bound when `sizePartial` because the walk hit its time budget. */
  size: Schema.Finite,
  sizePartial: Schema.Boolean,
  changes: Changes,
  ahead: Schema.optional(Schema.Finite),
  behind: Schema.optional(Schema.Finite),
  /** The branch is contained in the default branch, its upstream is gone, or its pull request merged. */
  merged: Schema.Boolean,
  /** Last commit or index change, in epoch milliseconds. */
  activity: Schema.optional(Schema.Finite),
  sessions: Schema.Array(Session),
}).annotate({ identifier: "WorktreeInventoryInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const Inventory = Schema.Struct({
  root: Schema.String,
  base: Schema.optional(Schema.String),
  worktrees: Schema.Array(Info),
}).annotate({ identifier: "WorktreeInventory" })
export type Inventory = Schema.Schema.Type<typeof Inventory>

export const RemoveResult = Schema.Struct({
  path: Schema.String,
  branch: Schema.optional(Schema.String),
  branchDeleted: Schema.Boolean,
  freed: Schema.Finite,
}).annotate({ identifier: "WorktreeInventoryRemoveResult" })
export type RemoveResult = Schema.Schema.Type<typeof RemoveResult>

export const CleanResult = Schema.Struct({
  dryRun: Schema.Boolean,
  candidates: Schema.Array(Info),
  removed: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
  pruned: Schema.Array(Schema.String),
  freed: Schema.Finite,
}).annotate({ identifier: "WorktreeInventoryCleanResult" })
export type CleanResult = Schema.Schema.Type<typeof CleanResult>

export class Refused extends Schema.TaggedErrorClass<Refused>()("WorktreeInventory.Refused", {
  message: Schema.String,
}) {}

export type ListInput = {
  /** Any directory inside the repository; the worktree containing it is current. */
  readonly directory: string
  /** More directories whose worktrees must never be removed, such as busy sessions. */
  readonly protect?: readonly string[]
  /** Ask `gh` which branches had their pull request merged, for squash merges. */
  readonly pullRequests?: boolean
  /** Time budget shared by all size walks. */
  readonly sizeBudgetMs?: number
}

export type RemoveInput = ListInput & {
  /** Path (absolute or relative to the primary checkout), worktree name or branch. */
  readonly target: string
  /** Discard uncommitted changes or remove a locked worktree. */
  readonly force?: boolean
  /** Delete the local branch too when it is merged. */
  readonly deleteBranch?: boolean
}

export type CleanInput = ListInput & {
  /** Remove clean worktrees whose branch merged. The default when `staleDays` is absent. */
  readonly merged?: boolean
  /** Remove clean worktrees without activity for this many days. */
  readonly staleDays?: number
  readonly dryRun?: boolean
  /** Delete merged branches of removed worktrees. Defaults to true. */
  readonly deleteBranch?: boolean
}

export async function list(input: ListInput): Promise<Inventory> {
  const root = await primaryRoot(input.directory)
  const entries = parse((await git(root, ["worktree", "list", "--porcelain"])).output)
  const base = await defaultBranch(root)
  const gone = await goneBranches(root)
  const merged = input.pullRequests ? await mergedPullRequests(root) : new Set<string>()
  const paths = await Promise.all(entries.map((entry) => (entry.prunable ? entry.path : canonical(entry.path))))
  const protect = await Promise.all([input.directory, ...(input.protect ?? [])].map(canonical))
  // A protected directory belongs to the innermost worktree containing it: nested worktrees sit inside the primary.
  const current = new Set(
    protect.flatMap(
      (item) => paths.filter((candidate) => within(candidate, item)).toSorted((a, b) => b.length - a.length)[0] ?? [],
    ),
  )
  const deadline = Date.now() + (input.sizeBudgetMs ?? 2_000)
  const worktrees = await Promise.all(
    entries.map((entry, index) =>
      describe({
        entry: { ...entry, path: paths[index] },
        primary: index === 0,
        current: current.has(paths[index]),
        // Nested worktrees are counted once, as themselves, not again inside the primary checkout.
        skip: new Set(index === 0 ? paths.slice(1) : []),
        root,
        base,
        gone,
        merged,
        deadline,
      }),
    ),
  )
  return { root, base, worktrees }
}

export async function remove(input: RemoveInput): Promise<RemoveResult> {
  const inventory = await list(input)
  const target = await resolve(inventory, input.target)
  if (!target) throw new Refused({ message: `No worktree matches ${input.target}.` })
  refuse(target, input.force)
  return removeEntry(inventory.root, target, input)
}

export async function clean(input: CleanInput): Promise<CleanResult> {
  const inventory = await list(input)
  const merged = input.merged ?? input.staleDays === undefined
  const cutoff = input.staleDays === undefined ? undefined : Date.now() - input.staleDays * 86_400_000
  const candidates = inventory.worktrees.filter(
    (item) =>
      !item.primary &&
      !item.current &&
      !item.locked &&
      !item.prunable &&
      item.changes.tracked + item.changes.untracked === 0 &&
      ((merged && item.merged) || (cutoff !== undefined && (item.activity ?? 0) < cutoff)),
  )
  // Git reports what prune would remove on stderr.
  const stale = (await git(inventory.root, ["worktree", "prune", "--dry-run", "--verbose"])).error
    .split("\n")
    .flatMap((line) => line.match(/^Removing (?:worktrees\/)?(.+?):/)?.slice(1) ?? [])
  const freed = candidates.reduce((total, item) => total + item.size, 0)
  if (input.dryRun) return { dryRun: true, candidates, removed: [], failed: [], pruned: stale, freed }
  if (stale.length > 0) await git(inventory.root, ["worktree", "prune"])
  // One at a time: removals and branch deletions share the repository's metadata locks.
  const results: { path: string; freed: number; message?: string }[] = []
  for (const item of candidates)
    results.push(
      await removeEntry(inventory.root, item, { deleteBranch: input.deleteBranch ?? true }).then(
        (result) => ({ path: result.path, freed: result.freed }),
        (error: unknown) => ({
          path: item.path,
          freed: 0,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    )
  return {
    dryRun: false,
    candidates,
    removed: results.filter((result) => result.message === undefined).map((result) => result.path),
    failed: results.flatMap((result) =>
      result.message === undefined ? [] : [{ path: result.path, message: result.message }],
    ),
    pruned: stale,
    freed: results.reduce((total, result) => total + result.freed, 0),
  }
}

function refuse(target: Info, force: boolean | undefined) {
  if (target.primary) throw new Refused({ message: `${target.path} is the primary checkout and is never removed.` })
  if (target.current)
    throw new Refused({ message: `${target.path} is the current worktree of an active session and is kept.` })
  const pending = target.changes.tracked + target.changes.untracked
  if (pending > 0 && !force)
    throw new Refused({
      message: `${target.path} has ${pending} uncommitted change${pending === 1 ? "" : "s"} (${target.changes.tracked} tracked, ${target.changes.untracked} untracked). Nothing was removed; confirm with force to discard them.`,
    })
  if (target.locked && !force)
    throw new Refused({ message: `${target.path} is locked. Nothing was removed; confirm with force to remove it.` })
}

async function removeEntry(root: string, target: Info, input: { force?: boolean; deleteBranch?: boolean }) {
  if (target.prunable) {
    await git(root, ["worktree", "prune"])
    return { path: target.path, branch: target.branch, branchDeleted: false, freed: 0 }
  }
  const force = input.force ? (target.locked ? ["--force", "--force"] : ["--force"]) : []
  const removed = await git(root, ["worktree", "remove", ...force, target.path])
  if (removed.exit !== 0) throw new Refused({ message: `Cannot remove ${target.path}: ${removed.error.trim()}` })
  sizes.delete(target.path)
  const branchDeleted =
    Boolean(input.deleteBranch && target.branch && target.merged) &&
    (await git(root, ["branch", "-D", target.branch!])).exit === 0
  return { path: target.path, branch: target.branch, branchDeleted, freed: target.size }
}

async function resolve(inventory: Inventory, target: string) {
  const absolute = await canonical(path.resolve(inventory.root, target))
  return (
    inventory.worktrees.find((item) => item.path === absolute) ??
    inventory.worktrees.find((item) => item.branch === target) ??
    inventory.worktrees.find((item) => !item.primary && path.basename(item.path) === target)
  )
}

type Entry = { path: string; head: string; branch?: string; locked: boolean; prunable: boolean }

/** Parses `git worktree list --porcelain`: blank-line separated records, the primary checkout first. */
export function parse(output: string): Entry[] {
  return output
    .split(/\r?\n\r?\n/)
    .map((record) => record.split(/\r?\n/).filter(Boolean))
    .filter((lines) => lines[0]?.startsWith("worktree "))
    .map((lines) => {
      const value = (key: string) =>
        lines.find((line) => line === key || line.startsWith(key + " "))?.slice(key.length + 1)
      const branch = value("branch")
      return {
        path: value("worktree")!,
        head: value("HEAD") ?? "",
        ...(branch ? { branch: branch.replace(/^refs\/heads\//, "") } : {}),
        locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
        prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
      }
    })
}

async function describe(input: {
  entry: Entry
  primary: boolean
  root: string
  base?: string
  gone: ReadonlySet<string>
  merged: ReadonlySet<string>
  current: boolean
  skip: ReadonlySet<string>
  deadline: number
}): Promise<Info> {
  const entry = input.entry
  const directory = entry.path
  const relative = path.relative(input.root, directory)
  const nested = !input.primary && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  const shared = {
    path: directory,
    ...(nested ? { relative: relative.split(path.sep).join("/") } : {}),
    ...(entry.branch ? { branch: entry.branch } : {}),
    head: entry.head,
    primary: input.primary,
    current: input.current,
    locked: entry.locked,
    prunable: entry.prunable,
    sessions: [],
  }
  if (entry.prunable)
    return { ...shared, size: 0, sizePartial: false, changes: { tracked: 0, untracked: 0 }, merged: false }
  const [size, changes, divergence, contained, activity] = await Promise.all([
    measure(directory, input.deadline, input.skip),
    pending(directory),
    input.base && !input.primary ? diverge(directory, input.base) : undefined,
    input.base && !input.primary ? ancestor(directory, input.base) : false,
    lastActivity(directory),
  ])
  const merged =
    !input.primary &&
    Boolean(contained || (entry.branch && (input.gone.has(entry.branch) || input.merged.has(entry.branch))))
  return {
    ...shared,
    size: size.bytes,
    sizePartial: size.partial,
    changes,
    ...(divergence ?? {}),
    merged,
    ...(activity ? { activity } : {}),
  }
}

async function pending(directory: string) {
  const lines = (await git(directory, ["status", "--porcelain", "--untracked-files=normal"])).output
    .split("\n")
    .filter(Boolean)
  const untracked = lines.filter((line) => line.startsWith("??")).length
  return { tracked: lines.length - untracked, untracked }
}

async function diverge(directory: string, base: string) {
  const result = await git(directory, ["rev-list", "--left-right", "--count", `${base}...HEAD`])
  const [behind, ahead] = result.output.trim().split(/\s+/).map(Number)
  if (result.exit !== 0 || !Number.isFinite(ahead) || !Number.isFinite(behind)) return undefined
  return { ahead, behind }
}

async function ancestor(directory: string, base: string) {
  return (await git(directory, ["merge-base", "--is-ancestor", "HEAD", base])).exit === 0
}

async function lastActivity(directory: string) {
  const commit = Number((await git(directory, ["log", "-1", "--format=%ct"])).output.trim()) * 1000
  const pointer = await Bun.file(path.join(directory, ".git"))
    .text()
    .catch(() => "")
  const gitdir = pointer.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  const index = await stat(path.join(gitdir ? path.resolve(directory, gitdir) : path.join(directory, ".git"), "index"))
    .then((info) => info.mtimeMs)
    .catch(() => 0)
  return Math.max(Number.isFinite(commit) ? commit : 0, index) || undefined
}

async function primaryRoot(directory: string) {
  const repository = await RepositoryGuard.inspect(directory)
  if (!repository) throw new Refused({ message: `${directory} is not inside a Git repository.` })
  const entries = parse((await git(repository.root, ["worktree", "list", "--porcelain"])).output)
  return entries[0] ? canonical(entries[0].path) : repository.root
}

/** `origin/HEAD` when the remote names it, else the first existing of origin/main, origin/master, main, master. */
async function defaultBranch(root: string) {
  const remote = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
  if (remote.exit === 0 && remote.output.trim()) return remote.output.trim()
  const candidates = ["origin/main", "origin/master", "main", "master"]
  const present = await Promise.all(
    candidates.map(async (name) => (await git(root, ["rev-parse", "--verify", "--quiet", name])).exit === 0),
  )
  return candidates.find((_, index) => present[index])
}

async function goneBranches(root: string) {
  const output = (await git(root, ["for-each-ref", "--format=%(refname:short)\t%(upstream:track)", "refs/heads"]))
    .output
  return new Set(
    output.split("\n").flatMap((line) => {
      const [branch, track] = line.split("\t")
      return branch && track?.includes("gone") ? [branch] : []
    }),
  )
}

/** Branches whose pull request merged, from `gh`; empty when it is missing, offline or slow. */
async function mergedPullRequests(root: string) {
  if (!Bun.which("gh")) return new Set<string>()
  const proc = Bun.spawn(
    ["gh", "pr", "list", "--state", "merged", "--limit", "200", "--json", "headRefName", "--jq", ".[].headRefName"],
    { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 10_000 },
  )
  const [output, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return new Set(exit === 0 ? output.split("\n").filter(Boolean) : [])
}

const sizes = new Map<string, { at: number; bytes: number }>()

/** Disk usage of a directory, walked until `deadline`; complete results are cached for five minutes. */
export async function measure(directory: string, deadline: number, skip: ReadonlySet<string> = new Set()) {
  const cached = sizes.get(directory)
  if (cached && Date.now() - cached.at < 300_000) return { bytes: cached.bytes, partial: false }
  const walk = async (current: string): Promise<{ bytes: number; partial: boolean }> => {
    if (Date.now() > deadline) return { bytes: 0, partial: true }
    const children = await readdir(current, { withFileTypes: true }).catch(() => [])
    const parts = await Promise.all(
      children.map((child) => {
        const target = path.join(current, child.name)
        if (skip.has(target)) return { bytes: 0, partial: false }
        if (child.isDirectory()) return walk(target)
        return lstat(target).then(
          (info) => ({ bytes: info.size, partial: false }),
          () => ({ bytes: 0, partial: false }),
        )
      }),
    )
    return {
      bytes: parts.reduce((total, part) => total + part.bytes, 0),
      partial: parts.some((part) => part.partial),
    }
  }
  const result = await walk(directory)
  if (!result.partial) sizes.set(directory, { at: Date.now(), bytes: result.bytes })
  return result
}

const within = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function canonical(target: string) {
  return realpath(target).catch(() => path.resolve(target))
}

async function git(directory: string, args: string[]) {
  const proc = Bun.spawn(["git", "-C", directory, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
      GIT_OPTIONAL_LOCKS: "0",
    },
  })
  const [output, error, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { output, error, exit }
}

/** Compact columns for one worktree, e.g. `⎇ .red/worktrees/x`, `⑂ x`, `1.2G`, `dirty·3d`. */
export function summary(info: Info, now = Date.now()) {
  const pending = info.changes.tracked + info.changes.untracked
  const state = info.prunable ? "missing" : pending > 0 ? "dirty" : info.merged ? "merged" : "clean"
  return {
    location: `⎇ ${info.primary ? "primary checkout" : (info.relative ?? `${temporary(info.path) ? "tmp " : ""}${info.path}`)}`,
    branch: `⑂ ${info.branch ?? info.head.slice(0, 7)}`,
    size: `${info.sizePartial ? "≥" : ""}${bytes(info.size)}`,
    state: [
      state,
      ...(info.activity ? [age(now - info.activity)] : []),
      ...(info.locked ? ["locked"] : []),
      ...(info.current ? ["current"] : []),
    ].join("·"),
  }
}

/** A `--tmp` session worktree, under `<tmp>/redcode-worktrees/`. */
const temporary = (directory: string) => directory.split(/[\\/]/).includes(RepositoryGuard.TEMPORARY)

/** Bytes as `512B`, `4.2K`, `31M`, `1.2G`: one decimal below ten units. */
export function bytes(value: number) {
  const units = ["B", "K", "M", "G", "T"]
  const exponent = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(value, 1)) / Math.log(1024))))
  const scaled = value / 1024 ** exponent
  return `${exponent > 0 && scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}${units[exponent]}`
}

/** A duration as its largest whole unit: `now`, `5m`, `3h`, `2d`, `3w`, `4mo`, `1y`. */
export function age(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

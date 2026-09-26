import { lstat, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { project } from "./shared"

type GitEntry = {
  directory: string
  head: string
  branch?: string
  locked: boolean
  prunable: boolean
}

export type Entry = GitEntry & {
  path: string
  relative?: string
  strategy?: string
  registered: boolean
  primary: boolean
  current: boolean
  size: number
  sizePartial: boolean
  changes?: { tracked: number; untracked: number }
  ahead?: number
  behind?: number
  merged?: boolean
  activity?: number
  sessions: { id: string; title?: string; updated: number }[]
}

export const inventory = Effect.fn("cli.worktrees.inventory")(function* () {
  const context = yield* project()
  const registered = yield* Effect.promise(() => context.client.worktree.list({ projectID: context.projectID }))
  const worktrees = Bun.which("git")
    ? yield* Effect.promise(() => git(process.cwd(), ["worktree", "list", "--porcelain"]))
    : undefined
  const gitEntries = yield* Effect.promise(() =>
    Promise.all((worktrees?.exit === 0 ? parse(worktrees.output) : []).map(async (entry) => ({
      ...entry,
      directory: await canonical(entry.directory),
    }))),
  )
  const root = gitEntries[0]?.directory
  const base = root ? yield* Effect.promise(() => defaultBranch(root)) : undefined
  const gone = root ? yield* Effect.promise(() => goneBranches(root)) : new Set<string>()
  const mergedPRs = root ? yield* Effect.promise(() => mergedPullRequests(root)) : new Set<string>()
  const sessions = yield* Effect.promise(async () => {
    const rows: { id: string; title?: string; directory: string; updated: number }[] = []
    let cursor: string | undefined
    do {
      const page = await context.client.session.list({ project: context.projectID, order: "desc", limit: 100, cursor })
      rows.push(...page.data.map((session) => ({
        id: session.id,
        title: session.title,
        directory: session.location.directory,
        updated: session.time.updated,
      })))
      cursor = page.cursor.next ?? undefined
    } while (cursor)
    return rows
  })
  const directories = [...new Set([...registered.map((entry) => entry.directory), ...gitEntries.map((entry) => entry.directory)])]
  const owner = (sessionDirectory: string) =>
    directories.filter((item) => contains(item, sessionDirectory)).toSorted((a, b) => b.length - a.length)[0]
  const deadline = Date.now() + 2_000
  const entries = yield* Effect.promise(() =>
    Promise.all(directories.map(async (directory): Promise<Entry> => {
      const stored = registered.find((entry) => entry.directory === directory)
      const found = gitEntries.find((entry) => entry.directory === directory)
      const current = owner(process.cwd()) === directory || sessions.some(
        (session) => Date.now() - session.updated < 3_600_000 && owner(session.directory) === directory,
      )
      const primary = root === directory
      const relative = root ? path.relative(root, directory) : undefined
      const shared = {
        directory,
        path: directory,
        relative: root && relative && contains(root, directory) ? relative.split(path.sep).join("/") : undefined,
        head: found?.head ?? "",
        branch: found?.branch,
        locked: found?.locked ?? false,
        prunable: found?.prunable ?? false,
        strategy: stored?.strategy,
        registered: Boolean(stored),
        primary,
        current,
        sessions: sessions.filter((session) => owner(session.directory) === directory).map((session) => ({
          id: session.id,
          title: session.title,
          updated: session.updated,
        })),
      }
      if (!found || found.prunable) return { ...shared, size: 0, sizePartial: false }
      const [size, changes, divergence, contained, activity] = await Promise.all([
        measure(directory, deadline, new Set(primary ? gitEntries.slice(1).map((item) => item.directory) : [])),
        pending(directory),
        base && !primary ? diverge(directory, base) : undefined,
        base && !primary ? git(directory, ["merge-base", "--is-ancestor", "HEAD", base]) : undefined,
        lastActivity(directory),
      ])
      return {
        ...shared,
        ...size,
        changes,
        ...divergence,
        merged: !primary && Boolean(contained?.exit === 0 || (found.branch && (gone.has(found.branch) || mergedPRs.has(found.branch)))),
        activity,
      }
    })),
  )
  return { root, base, worktrees: entries }
})

function parse(output: string): GitEntry[] {
  return output.split(/\r?\n\r?\n/).map((record) => record.split(/\r?\n/)).filter((lines) => lines[0]?.startsWith("worktree ")).map((lines) => {
    const value = (key: string) => lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1)
    const branch = value("branch")
    return {
      directory: value("worktree")!,
      head: value("HEAD") ?? "",
      branch: branch?.replace(/^refs\/heads\//, ""),
      locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
      prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
    }
  })
}

async function defaultBranch(root: string) {
  const remote = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
  if (remote.exit === 0 && remote.output.trim()) return remote.output.trim()
  const candidates = ["origin/main", "origin/master", "main", "master"]
  const present = await Promise.all(candidates.map(async (branch) => (await git(root, ["rev-parse", "--verify", "--quiet", branch])).exit === 0))
  return candidates.find((_, index) => present[index])
}

async function goneBranches(root: string) {
  const result = await git(root, ["for-each-ref", "--format=%(refname:short)\t%(upstream:track)", "refs/heads"])
  return new Set(result.output.split("\n").flatMap((line) => {
    const [branch, track] = line.split("\t")
    return branch && track?.includes("gone") ? [branch] : []
  }))
}

async function mergedPullRequests(root: string) {
  if (!Bun.which("gh")) return new Set<string>()
  const child = Bun.spawn(["gh", "pr", "list", "--state", "merged", "--limit", "200", "--json", "headRefName", "--jq", ".[].headRefName"], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 10_000,
  })
  const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return new Set(exit === 0 ? output.split("\n").filter(Boolean) : [])
}

async function pending(directory: string) {
  const result = await git(directory, ["status", "--porcelain", "--untracked-files=normal"])
  if (result.exit !== 0) return undefined
  const lines = result.output.split("\n").filter(Boolean)
  const untracked = lines.filter((line) => line.startsWith("??")).length
  return { tracked: lines.length - untracked, untracked }
}

async function diverge(directory: string, base: string) {
  const result = await git(directory, ["rev-list", "--left-right", "--count", `${base}...HEAD`])
  const [behind, ahead] = result.output.trim().split(/\s+/).map(Number)
  if (result.exit !== 0 || !Number.isFinite(ahead) || !Number.isFinite(behind)) return {}
  return { ahead, behind }
}

async function lastActivity(directory: string) {
  const result = await git(directory, ["log", "-1", "--format=%ct"])
  const commit = Number(result.output.trim()) * 1000
  const pointer = await Bun.file(path.join(directory, ".git")).text().catch(() => "")
  const gitdir = pointer.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  const index = await stat(path.join(gitdir ? path.resolve(directory, gitdir) : path.join(directory, ".git"), "index"))
    .then((info) => info.mtimeMs).catch(() => 0)
  return Math.max(Number.isFinite(commit) ? commit : 0, index) || undefined
}

async function measure(directory: string, deadline: number, skip: ReadonlySet<string>): Promise<{ size: number; sizePartial: boolean }> {
  if (Date.now() > deadline) return { size: 0, sizePartial: true }
  const children = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const parts = await Promise.all(children.map(async (child) => {
    const target = path.join(directory, child.name)
    if (skip.has(target)) return { size: 0, sizePartial: false }
    if (child.isDirectory()) return measure(target, deadline, skip)
    return { size: await lstat(target).then((info) => info.size).catch(() => 0), sizePartial: false }
  }))
  return { size: parts.reduce((total, item) => total + item.size, 0), sizePartial: parts.some((item) => item.sizePartial) }
}

export function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export async function canonical(directory: string) {
  return realpath(directory).catch(() => path.resolve(directory))
}

export async function git(directory: string, args: string[], write = false) {
  const child = Bun.spawn(["git", "-C", directory, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
      GIT_OPTIONAL_LOCKS: write ? "1" : "0",
    },
  })
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { output, error, exit }
}

export function bytes(value: number) {
  const units = ["B", "K", "M", "G", "T"]
  const exponent = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(value, 1)) / Math.log(1024))))
  const scaled = value / 1024 ** exponent
  return `${exponent > 0 && scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}${units[exponent]}`
}

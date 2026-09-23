// Scratch roots that a test process owns for its whole life: the per-process XDG/home trees the
// preloads point the app at, and the HttpApi exerciser's global root. They are removed when the
// run ends however it ends — finished, failed, interrupted or killed — because each one left
// behind costs hundreds of megabytes of /tmp, and a git worktree created inside one stays
// registered in the repository that owns it until someone prunes it by hand.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Point Playwright at the invoking user's own browser cache. Playwright otherwise resolves its
 * cache from XDG_CACHE_HOME/HOME, which the preloads repoint per process, so every run downloaded
 * Chromium (~630 MB) into a directory that was thrown away afterwards. Call it before HOME and the
 * XDG variables are overridden. Browser builds are versioned directories and Playwright takes its
 * own lock while installing, so sharing the cache between concurrent runs is safe.
 */
export function sharePlaywrightBrowsers() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return
  const home = os.homedir()
  const base =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Caches")
        : process.env.XDG_CACHE_HOME || path.join(home, ".cache")
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(base, "ms-playwright")
}

const prefixes = [
  "redcode-core-test-",
  "redcode-design-app-test-",
  "redcode-tui-test-",
  "opencode-test-data-",
  "opencode-httpapi-global-",
  "opencode-httpapi-exercise-",
]

function real(target: string) {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

/**
 * The only paths this module will delete: a scratch root named for the owning process, directly
 * in the system temp directory. Returned with the temp directory's real path, so `/var` and
 * `/private/var` (macOS) or a symlinked TMPDIR compare equal.
 */
function owned(target: string, pid: number) {
  const resolved = path.resolve(target)
  const tmp = real(os.tmpdir())
  const name = path.basename(resolved)
  const suffix = prefixes.map((prefix) => `${prefix}${pid}`).find((stem) => name.startsWith(stem))
  const rest = suffix === undefined ? undefined : name.slice(suffix.length)
  if (real(path.dirname(resolved)) !== tmp || rest === undefined || !/^(\.db(-wal|-shm)?)?$/.test(rest))
    throw new Error(`refusing to remove ${target}: not a test scratch root of process ${pid} directly under ${tmp}`)
  return path.join(tmp, name)
}

const skipped = new Set([".git", "node_modules", "ms-playwright"])

function inside(roots: string[], target: string) {
  return roots.some((root) => {
    const relative = path.relative(root, target)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  })
}

/** Directories under `root` that are linked git worktrees (a `.git` file, not a directory). */
function linkedWorktrees(root: string) {
  const found: string[] = []
  const walk = (directory: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((entry) => entry.name === ".git" && entry.isFile())) {
      found.push(directory)
      return
    }
    if (depth === 0) return
    for (const entry of entries) {
      if (entry.isDirectory() && !skipped.has(entry.name)) walk(path.join(directory, entry.name), depth - 1)
    }
  }
  // Worktrees land at <home>/.red/code/data/worktree/<project>/<name>; the bound keeps the walk off
  // anything deeper than that.
  walk(root, 9)
  return found
}

/**
 * Unregister worktrees under `root` from repositories outside it, returning the admin entries git
 * refused to remove. A repository inside `root` disappears with it, registrations and all; one
 * outside (the checkout the run was started from) would otherwise keep a prunable entry pointing
 * into a deleted directory.
 */
export function releaseWorktrees(root: string) {
  const roots = [path.resolve(root), real(root)]
  const stale: string[] = []
  for (const worktree of linkedWorktrees(real(root))) {
    let admin: string
    try {
      const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(path.join(worktree, ".git"), "utf8"))
      if (!match?.[1]) continue
      admin = path.resolve(worktree, match[1].trim())
    } catch {
      continue
    }
    // <common-dir>/worktrees/<name>
    const common = path.dirname(path.dirname(admin))
    if (inside(roots, common) || inside(roots, real(common))) continue
    const removed = spawnSync("git", ["--git-dir", common, "worktree", "remove", "--force", "--force", worktree], {
      stdio: "ignore",
    })
    if (removed.status !== 0) stale.push(admin)
  }
  return stale
}

function pruneAdmin(admin: string, roots: string[]) {
  // The targeted equivalent of `git worktree prune`: only the entry that pointed into this root,
  // never unrelated stale entries someone else may still want to inspect.
  try {
    const pointer = fs.readFileSync(path.join(admin, "gitdir"), "utf8").trim()
    if (inside(roots, pointer)) fs.rmSync(admin, { recursive: true, force: true })
  } catch {}
}

/**
 * Remove scratch roots of process `pid` now, synchronously, detaching any git worktrees inside them
 * first. Throws for anything that is not such a root.
 */
export function removeTempPaths(paths: Iterable<string>, pid = process.pid) {
  for (const given of paths) {
    const target = owned(given, pid)
    const roots = [path.resolve(given), target]
    const stale = fs.existsSync(target) ? releaseWorktrees(target) : []
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
    for (const admin of stale) pruneAdmin(admin, roots)
  }
}

const registered = new Set<string>()
let exitHook = false

/**
 * Remove `paths` when this process ends, however it ends.
 *
 * Signal handlers cannot do this. A listener for SIGINT replaces the default action, and it only
 * runs when the event loop turns: a test spinning in synchronous code then ignores Ctrl+C, the
 * first and the second, until it finishes on its own. Instead a small detached process watches
 * this one and removes the paths once it is gone — after a normal exit, a signal, or SIGKILL — so
 * interrupting a run keeps its default behaviour. An `exit` hook removes them straight away when
 * the process exits through `process.exit`; `bun test` does not emit `exit` after a run, so a
 * preload should also call `removeTempPaths` from `afterAll`.
 */
export function removeOnExit(...paths: string[]) {
  const targets = paths.map((target) => owned(target, process.pid))
  for (const target of targets) registered.add(target)
  if (!exitHook) {
    exitHook = true
    process.on("exit", () => removeTempPaths(registered))
  }
  // `bun test --parallel` runs every file in a fresh global, preload included, so the guard above
  // resets per file. A marker on disk keeps it to one reaper per process and set of paths rather
  // than one idle `bun` per test file for the life of the worker.
  try {
    fs.writeFileSync(reaperMarker(process.pid, targets), "", { flag: "wx" })
  } catch {
    return
  }
  const reaper = spawn(process.execPath, [fileURLToPath(import.meta.url), String(process.pid), ...targets], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  reaper.on("error", () => undefined)
  reaper.unref()
}

if (import.meta.main) {
  const [pid, ...paths] = process.argv.slice(2)
  const parent = Number(pid)
  const alive = () => {
    try {
      process.kill(parent, 0)
      return true
    } catch (error) {
      return !!error && typeof error === "object" && "code" in error && error.code === "EPERM"
    }
  }
  const timer = setInterval(() => {
    if (alive()) return
    clearInterval(timer)
    removeTempPaths(paths, parent)
    fs.rmSync(reaperMarker(parent, paths), { force: true })
  }, 500)
}

function reaperMarker(pid: number, targets: string[]) {
  return path.join(os.tmpdir(), `redcode-test-reaper-${pid}-${Bun.hash(targets.join("\n")).toString(36)}`)
}

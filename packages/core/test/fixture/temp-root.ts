// Scratch roots that a test process owns for its whole life: the per-process XDG/home trees the
// preloads point the app at, and the HttpApi exerciser's global root. They are removed when the
// run ends however it ends — finished, failed, or interrupted — because each one left behind costs
// hundreds of megabytes of /tmp, and a git worktree created inside one stays registered in the
// repository that owns it until someone prunes it by hand.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
      ? (process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"))
      : process.platform === "darwin"
        ? path.join(home, "Library", "Caches")
        : (process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(base, "ms-playwright")
}

const skipped = new Set([".git", "node_modules", "ms-playwright"])

function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
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
 * Unregister worktrees under `root` from repositories outside it. A repository inside `root`
 * disappears with it, registrations and all; one outside (the checkout the run was started from)
 * would otherwise keep a prunable entry pointing into a deleted directory.
 */
export function releaseWorktrees(root: string) {
  const stale: string[] = []
  for (const worktree of linkedWorktrees(root)) {
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
    if (inside(root, common)) continue
    const removed = spawnSync("git", ["--git-dir", common, "worktree", "remove", "--force", "--force", worktree], {
      stdio: "ignore",
    })
    if (removed.status !== 0) stale.push(admin)
  }
  return stale
}

function pruneAdmin(admin: string, root: string) {
  // The targeted equivalent of `git worktree prune`: only the entry that pointed into this root,
  // never unrelated stale entries someone else may still want to inspect.
  try {
    const pointer = fs.readFileSync(path.join(admin, "gitdir"), "utf8").trim()
    if (inside(root, pointer)) fs.rmSync(admin, { recursive: true, force: true })
  } catch {}
}

/** Remove scratch paths now, synchronously, detaching any git worktrees inside them first. */
export function removeTempPaths(paths: Iterable<string>) {
  for (const target of paths) {
    const stale = fs.existsSync(target) ? releaseWorktrees(target) : []
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
    for (const admin of stale) pruneAdmin(admin, target)
  }
}

const registered = new Set<string>()
let installed = false

/**
 * Remove `paths` when the process exits, including on SIGINT/SIGTERM/SIGHUP. A test runner's own
 * end-of-run hooks do not run when the process is interrupted, and `bun test` does not emit `exit`
 * after a normal run, so a preload should also call `removeTempPaths` from `afterAll`.
 */
export function removeOnExit(...paths: string[]) {
  for (const target of paths) registered.add(target)
  if (installed) return
  installed = true
  process.on("exit", () => removeTempPaths(registered))
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const) {
    // `once`: a second signal falls through to the default action if cleanup itself hangs.
    process.once(signal, () => process.exit(code))
  }
}

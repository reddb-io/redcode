import { lstatSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

const RUN_NAME = /^\d{8}T\d{6}$/

/** Prune history to five runs / 200 MiB including the active run, which is never deleted. */
export function cleanupLogRuns(
  root: string,
  active: string,
  options: { maxRuns?: number; maxBytes?: number; now?: number } = {},
) {
  const now = options.now ?? Date.now()
  const runs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_NAME.test(entry.name))
    .map((entry) => {
      const file = join(root, entry.name)
      return { file, active: resolve(file) === resolve(active), modified: lstatSync(file).mtimeMs, bytes: size(file) }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.modified - a.modified)
  let retained = 0
  let bytes = 0
  const removed: string[] = []
  for (const run of runs) {
    const expired = now - run.modified > 7 * 24 * 60 * 60 * 1000
    const overCount = retained >= (options.maxRuns ?? 5)
    const overSize = bytes + run.bytes > (options.maxBytes ?? 200 * 1024 * 1024)
    if (!run.active && (expired || overCount || overSize)) {
      rmSync(run.file, { recursive: true, force: true })
      removed.push(run.file)
      continue
    }
    retained++
    bytes += run.bytes
  }
  return { removed, bytes, retained }
}

function size(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) return total + size(file)
    if (entry.isFile()) return total + lstatSync(file).size
    return total
  }, 0)
}

/** Preserve earlier export sources while including the current and adopted legacy RedCode homes. */
export function diagnosticLogRoots(home: string, userData: string, xdgData: string) {
  return [
    ...new Set([
      join(home, ".red", "code", "data", "log"),
      join(home, ".red", "redcode", "data", "log"),
      join(xdgData, "opencode", "log"),
      join(userData, "opencode", "log"),
    ]),
  ]
}

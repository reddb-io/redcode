#!/usr/bin/env bun
/**
 * Typecheck one slice of the workspace.
 *
 * Every package at once needs more memory than a 4-vCPU runner has, and the pre-push hook that
 * used to do exactly that was killed mid-run often enough to lose a release. So CI runs the
 * packages in a fixed number of shards, each its own job: `bun script/typecheck-shard.ts 2 5`
 * runs the third of five. The assignment is by sorted package name, so it is stable across runs
 * and a failure names the package, not the shard.
 */
import path from "path"

const [indexArg, totalArg] = process.argv.slice(2)
const index = Number(indexArg)
const total = Number(totalArg)
if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
  console.error("usage: bun script/typecheck-shard.ts <index> <total>")
  process.exit(2)
}

const root = path.resolve(import.meta.dir, "..")
const manifest = (await Bun.file(path.join(root, "package.json")).json()) as {
  workspaces: string[] | { packages: string[] }
}
const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces.packages

// A Set, because the workspace globs overlap (`packages/*` and `packages/slack`).
const packages = new Set<string>()
for (const pattern of patterns) {
  const glob = new Bun.Glob(path.posix.join(pattern, "package.json"))
  for await (const file of glob.scan({ cwd: root, dot: false })) {
    if (file.includes("node_modules/")) continue
    const json = (await Bun.file(path.join(root, file)).json()) as { name?: string; scripts?: Record<string, string> }
    if (json.name && json.scripts?.typecheck) packages.add(json.name)
  }
}
const sorted = [...packages].sort()

const mine = sorted.filter((_, i) => i % total === index)
if (mine.length === 0) {
  console.log(`shard ${index + 1}/${total}: nothing to check`)
  process.exit(0)
}
console.log(`shard ${index + 1}/${total}: ${mine.join(", ")}`)

const proc = Bun.spawn(["bun", "turbo", "typecheck", ...mine.flatMap((name) => ["--filter", name])], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
})
process.exit(await proc.exited)

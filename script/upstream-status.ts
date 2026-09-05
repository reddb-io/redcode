#!/usr/bin/env bun
/**
 * What upstream has that we have not ported.
 *
 *   bun script/upstream-status.ts            # grouped by scope
 *   bun script/upstream-status.ts --fetch    # fetch upstream first
 *   bun script/upstream-status.ts --json
 *
 * "Ported" means an `Upstream: <sha>` trailer on one of our commits, or a line in
 * script/upstream-ported.txt. Nothing else counts: a fix that arrived by hand without the
 * trailer is a fix we cannot prove we have.
 */
import path from "path"
import { git, pending, UPSTREAM } from "./upstream-lib"

const root = path.resolve(import.meta.dir, "..")
const args = new Set(process.argv.slice(2))

if (args.has("--fetch")) {
  await git(["fetch", "--quiet", UPSTREAM.remote, UPSTREAM.branch], { cwd: root })
}

const { base, commits } = await pending(root)

if (args.has("--json")) {
  console.log(JSON.stringify({ base, upstream: `${UPSTREAM.remote}/${UPSTREAM.branch}`, pending: commits }, null, 2))
  process.exit(0)
}

const forkDate = (await git(["log", "-1", "--format=%ad", "--date=short", base], { cwd: root })).stdout.trim()
console.log(`Fork point ${base.slice(0, 9)} (${forkDate}); tracking ${UPSTREAM.repo}@${UPSTREAM.branch}.`)
if (commits.length === 0) {
  console.log("Nothing pending: every tracked upstream commit is ported or noise.")
  process.exit(0)
}
console.log(`${commits.length} upstream commit(s) not yet ported:\n`)
const byScope = new Map<string, typeof commits>()
for (const c of commits) byScope.set(c.scope, [...(byScope.get(c.scope) ?? []), c])
for (const [scope, items] of [...byScope.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${scope} (${items.length})`)
  for (const c of items) console.log(`  ${c.short}  ${c.date}  ${c.subject}`)
  console.log()
}
console.log(`Port one with: bun script/upstream-port.ts <sha>`)

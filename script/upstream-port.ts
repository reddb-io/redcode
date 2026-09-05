#!/usr/bin/env bun
/**
 * Bring one or more upstream commits across, names rewritten, decisions kept.
 *
 *   bun script/upstream-port.ts <sha> [<sha>…]
 *   bun script/upstream-port.ts --dry-run <sha>    # show the rewritten patch, apply nothing
 *
 * For each commit: take its diff, rewrite the paths and package names to ours, and apply it
 * with a three-way merge so a hunk that no longer fits leaves conflict markers instead of
 * silently dropping. A clean apply is committed at once with upstream's subject, a note saying
 * where it came from, and an `Upstream: <sha>` trailer — the trailer is the ledger. A conflicted
 * apply stops, leaves the markers in the tree, and says which files: what to keep there is a
 * decision, and the script does not make decisions.
 *
 * What it deliberately does not rewrite: the bare word "opencode" in prose or strings. Every
 * port is read by a person before it merges, and a product name in a sentence is theirs.
 */
import path from "path"
import { git, ported, rewrite, TRAILER, UPSTREAM } from "./upstream-lib"

const root = path.resolve(import.meta.dir, "..")
const argv = process.argv.slice(2)
const dryRun = argv.includes("--dry-run")
const shas = argv.filter((a) => !a.startsWith("--"))
if (shas.length === 0) {
  console.error("usage: bun script/upstream-port.ts [--dry-run] <sha> [<sha>…]")
  process.exit(2)
}

// Untracked files are not ours to worry about; tracked changes would mix with the port.
  const dirty = (await git(["status", "--porcelain", "--untracked-files=no"], { cwd: root })).stdout.trim()
if (dirty && !dryRun) {
  console.error("The working tree is not clean; a port must start from nothing so a conflict is only the port's.")
  process.exit(2)
}

const already = await ported(root)

for (const given of shas) {
  const sha = (await git(["rev-parse", "--verify", `${given}^{commit}`], { cwd: root })).stdout.trim()
  const subject = (await git(["log", "-1", "--format=%s", sha], { cwd: root })).stdout.trim()
  const body = (await git(["log", "-1", "--format=%b", sha], { cwd: root })).stdout.trim()
  if (already.has(sha)) {
    console.log(`skip ${sha.slice(0, 9)}: already ported — ${subject}`)
    continue
  }

  const raw = (await git(["show", "--format=", "--binary", "-M", sha], { cwd: root })).stdout
  const patch = rewrite(raw)
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!)
  console.log(`\n${sha.slice(0, 9)}  ${subject}`)
  for (const f of files) console.log(`  ${f}`)

  if (dryRun) {
    console.log(patch)
    continue
  }

  const tmp = path.join(root, ".git", `upstream-port-${sha.slice(0, 9)}.patch`)
  await Bun.write(tmp, patch)
  const apply = await git(["apply", "--3way", "--index", "--recount", tmp], { cwd: root, check: false })
  const conflicted = (await git(["diff", "--name-only", "--diff-filter=U"], { cwd: root })).stdout.trim()

  if (apply.code !== 0 && !conflicted) {
    // Nothing could be applied, not even with a three-way merge: the code moved too far.
    console.error(`\n${sha.slice(0, 9)} could not be applied at all:\n${apply.stderr.trim()}`)
    console.error(`The rewritten patch is at ${tmp}; port it by hand and commit with "${TRAILER}: ${sha}".`)
    process.exit(1)
  }

  if (conflicted) {
    console.error(
      `\n${sha.slice(0, 9)} applied with conflicts in:\n${conflicted
        .split("\n")
        .map((f) => `  ${f}`)
        .join("\n")}`,
    )
    console.error(
      `Resolve them — keep our decisions where they differ — then commit with this trailer:\n\n  ${TRAILER}: ${sha}\n`,
    )
    console.error(`Upstream's message, for the commit body:\n\n${subject}\n\n${body}`)
    process.exit(1)
  }

  await Bun.file(tmp)
    .delete()
    .catch(() => undefined)
  const message = [
    subject,
    "",
    `Ported from ${UPSTREAM.repo} ${sha.slice(0, 9)}.`,
    ...(body ? ["", body] : []),
    "",
    `${TRAILER}: ${sha}`,
  ].join("\n")
  await git(["commit", "--quiet", "-m", message], { cwd: root })
  console.log(`  committed as ${(await git(["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim()}`)
}

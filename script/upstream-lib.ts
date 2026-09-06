/**
 * What redcode shares with upstream opencode, and how the two are spelled.
 *
 * We forked anomalyco/opencode and renamed the product; upstream keeps moving. A git merge is
 * off the table — the package was renamed on disk and in every import — so changes come across
 * as patches with the names rewritten, and each port records the upstream commit it came from
 * in an `Upstream:` trailer. Everything in this file is what those two scripts agree on.
 */

export const UPSTREAM = { remote: "upstream", branch: "dev", repo: "anomalyco/opencode" } as const
export const TRAILER = "Upstream"

/** The parts of the tree we track. Their hosted product and site are not ours to follow. */
export const TRACKED = [
  "packages/opencode",
  "packages/core",
  "packages/app",
  "packages/tui",
  "packages/ui",
  "packages/sdk",
  "packages/plugin",
  "packages/server",
  "packages/llm",
  "packages/session-ui",
  "packages/http-recorder",
  "packages/schema",
  "packages/protocol",
  "packages/cli",
  "packages/client",
  "packages/codemode",
  "packages/desktop",
  "packages/slack",
  "patches",
  "turbo.json",
  "script",
] as const

/** Subjects that are upstream's own release plumbing, never ours to port. */
export const NOISE = [/^sync release versions/i, /^chore: generate$/i, /^chore: bump .*versions/i]

/**
 * Ordered: longer, more specific spellings first, so `@opencode-ai/core` is rewritten before a
 * bare `opencode` could touch it. Bare "opencode" in prose is left alone on purpose — a port is
 * reviewed by a person, and a product name in a sentence is theirs to decide.
 */
export const RENAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/packages\/opencode\//g, "packages/redcode/"],
  [/@opencode-ai\//g, "@reddb-io/redcode-"],
  [/"opencode":\s*"workspace:\*"/g, '"@reddb-io/redcode": "workspace:*"'],
  [/\bOPENCODE_/g, "REDCODE_"],
  [/\.opencode\//g, ".red/code/"],
  [/\.opencode\b/g, ".red/code"],
  [/opencode\.json\b/g, "redcode.json"],
  [/opencode\.jsonc\b/g, "redcode.jsonc"],
]

export function rewrite(text: string) {
  let out = text
  for (const [from, to] of RENAMES) out = out.replace(from, to)
  return out
}

export async function git(args: string[], opts: { cwd?: string; check?: boolean } = {}) {
  const proc = Bun.spawn(["git", ...args], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (opts.check !== false && code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`)
  return { stdout, stderr, code }
}

/** Full SHAs of every upstream commit our history says it ported, from trailers and the seed file. */
export async function ported(root: string): Promise<Set<string>> {
  const out = new Set<string>()
  // HEAD, not main: a port on a branch counts while the branch is being worked on.
  const log = await git(["log", "--format=%B", "HEAD"], { cwd: root })
  const trailer = new RegExp(`^${TRAILER}:\\s*([0-9a-f]{7,40})\\s*$`, "gim")
  const short = new Set<string>()
  for (const m of log.stdout.matchAll(trailer)) short.add(m[1]!)
  const seed = await Bun.file(`${root}/script/upstream-ported.txt`)
    .text()
    .catch(() => "")
  // A line is a SHA, optionally followed by `# why` — ported elsewhere, superseded, or declined.
  // Declined counts as accounted for: the ledger's question is "did someone decide?", not "did
  // the code come across?".
  for (const line of seed.split("\n")) {
    const sha = line.trim().split(/\s+/)[0] ?? ""
    if (sha && !sha.startsWith("#")) short.add(sha)
  }
  for (const sha of short) {
    const full = await git(["rev-parse", "--verify", `${sha}^{commit}`], { cwd: root, check: false })
    if (full.code === 0) out.add(full.stdout.trim())
  }
  return out
}

export interface UpstreamCommit {
  readonly sha: string
  readonly short: string
  readonly date: string
  readonly subject: string
  readonly scope: string
}

/** Upstream commits since the fork point that touch what we track, oldest first. */
export async function pending(root: string): Promise<{ base: string; commits: UpstreamCommit[] }> {
  const target = `${UPSTREAM.remote}/${UPSTREAM.branch}`
  const base = (await git(["merge-base", "main", target], { cwd: root })).stdout.trim()
  const log = await git(
    [
      "log",
      "--no-merges",
      "--format=%H%x1f%h%x1f%ad%x1f%s",
      "--date=short",
      "--reverse",
      `${base}..${target}`,
      "--",
      ...TRACKED,
    ],
    { cwd: root },
  )
  const already = await ported(root)
  const commits: UpstreamCommit[] = []
  for (const line of log.stdout.split("\n")) {
    if (!line) continue
    const [sha, short, date, subject] = line.split("\x1f") as [string, string, string, string]
    if (already.has(sha)) continue
    if (NOISE.some((re) => re.test(subject))) continue
    const scope = /^[a-z]+\(([^)]+)\)/.exec(subject)?.[1] ?? "-"
    commits.push({ sha, short, date, subject, scope })
  }
  return { base, commits }
}

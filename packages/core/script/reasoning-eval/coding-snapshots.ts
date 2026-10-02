import path from "node:path"
import { mkdir, realpath, rm } from "node:fs/promises"
import { Hash } from "@opencode/util/hash"

/** Keep Git metadata outside resettable fixtures, with one stable project identity per case. */
export async function repository(directory: string, metadata: string) {
  await mkdir(metadata, { recursive: true })
  const initialized = await Bun.file(path.join(metadata, "HEAD")).exists()
  if (!initialized) {
    const result = await git(metadata, ["init", "--template=", "--separate-git-dir", metadata, directory])
    if (result.exit) throw new Error(`Fixture Git initialization failed: ${result.stderr}`)
  }
  const pointer = `gitdir: ${metadata.replaceAll("\\", "/")}\n`
  // Git marks this pointer hidden on Windows; replace it before Bun opens it for writing.
  await rm(path.join(directory, ".git"), { force: true })
  await Bun.write(path.join(directory, ".git"), pointer)
  if (initialized) return
  const added = await git(metadata, ["--git-dir", metadata, "--work-tree", directory, "add", "--all"])
  if (added.exit) throw new Error(`Fixture Git staging failed: ${added.stderr}`)
  const committed = await git(metadata, [
    "-c",
    "user.name=Redcode evaluation",
    "-c",
    "user.email=evaluation@localhost",
    "-c",
    "commit.gpgsign=false",
    "--git-dir",
    metadata,
    "--work-tree",
    directory,
    "commit",
    "-m",
    "Benchmark seed",
  ])
  if (committed.exit) throw new Error(`Fixture Git commit failed: ${committed.stderr}`)
}

/** Reconstruct an existing Step tree in a separate directory without moving the final candidate. */
export async function recover(input: {
  home: string
  directory: string
  projectID: string
  tree: string
  metadata: string
  destination: string
}) {
  if (!/^[a-z0-9_-]+$/i.test(input.projectID) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.tree))
    return { known: false as const, reason: "invalid_snapshot_identity" }
  const source = path.join(
    input.home,
    ".red",
    "code",
    "data",
    "snapshot",
    input.projectID,
    Hash.fast(await realpath(input.directory)),
  )
  const kind = await git(source, ["--git-dir", source, "cat-file", "-t", input.tree])
  if (kind.exit || kind.stdout.trim() !== "tree") return { known: false as const, reason: "snapshot_unavailable" }
  await mkdir(input.destination, { recursive: true })
  const index = path.join(input.destination, `snapshot-index-${crypto.randomUUID()}`)
  const loaded = await git(source, ["--git-dir", source, "read-tree", input.tree], index)
  if (loaded.exit) return { known: false as const, reason: "snapshot_index_failed" }
  const exported = await git(
    source,
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.symlinks=true",
      "--git-dir",
      source,
      "checkout-index",
      "--all",
      `--prefix=${input.destination.replaceAll("\\", "/")}/`,
    ],
    index,
  )
  await rm(index, { force: true })
  if (exported.exit) return { known: false as const, reason: "snapshot_export_failed" }
  // Git omits its pointer from trees; preserve the protected, harness-owned fixture pointer.
  await Bun.write(path.join(input.destination, ".git"), `gitdir: ${input.metadata.replaceAll("\\", "/")}\n`)
  return { known: true as const, tree: input.tree }
}

async function git(metadata: string, argv: string[], index?: string) {
  const child = Bun.spawn(["git", ...argv], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: path.dirname(metadata),
      USERPROFILE: path.dirname(metadata),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(path.dirname(metadata), ".evaluation.gitconfig"),
      GIT_TERMINAL_PROMPT: "0",
      ...(index ? { GIT_INDEX_FILE: index } : {}),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exit }
}

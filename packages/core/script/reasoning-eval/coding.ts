import { lstat, mkdir, readlink, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"
import type { CodingCase } from "./coding-cases"
import { repository } from "./coding-snapshots"

export const TIMEOUT_MS = 10_000
export const OUTPUT_LIMIT_BYTES = 1_048_576

const OracleOutput = Schema.Struct({
  checks: Schema.Array(Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)), pass: Schema.Boolean })).check(
    Schema.isMinLength(1),
  ),
})
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(OracleOutput))

export type Verification = {
  pass: boolean
  score: number
  format: boolean
  failed: string[]
  checks: ReadonlyArray<{ readonly id: string; readonly pass: boolean }>
  process: {
    exit: number | null
    durationMs: number
    stdoutBytes: number
    stderrBytes: number
    timedOut: boolean
  }
}

/** Reset an owned benchmark fixture between executions; never seed the oracle or reference solution. */
export async function prepare(item: CodingCase, directory: string, metadata?: string): Promise<void> {
  const paths = [...Object.keys(item.files), ...item.editable, ...Object.keys(item.reference)]
  const invalid = paths.find(
    (file) =>
      !file ||
      /[\\\0]/.test(file) ||
      /^[A-Za-z]:/.test(file) ||
      file.split("/").some((segment) => !segment || segment === "." || segment === ".."),
  )
  if (invalid !== undefined) throw new Error(`Invalid fixture path: ${invalid}`)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  await Promise.all(
    Object.entries(item.files).map(async ([file, content]) => {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await Bun.write(path.join(directory, file), content)
    }),
  )
  if (metadata) await repository(directory, metadata)
}

/** Content identities include new and deleted paths; do not follow a candidate's symlink out of the fixture. */
export async function snapshot(directory: string): Promise<Readonly<Record<string, string>>> {
  const files = new Map<string, string>()
  for await (const file of new Bun.Glob("**/*").scan({
    cwd: directory,
    dot: true,
    onlyFiles: false,
    followSymlinks: false,
  })) {
    const entry = await lstat(path.join(directory, file))
    if (entry.isDirectory()) continue
    const hash = new Bun.CryptoHasher("sha256")
    if (entry.isFile()) {
      for await (const chunk of Bun.file(path.join(directory, file)).stream()) hash.update(chunk)
    }
    if (entry.isSymbolicLink()) hash.update(`\0symlink\0${await readlink(path.join(directory, file))}`)
    if (!entry.isFile() && !entry.isSymbolicLink()) hash.update(`\0special\0${entry.mode & 0o170000}`)
    files.set(file.replaceAll(path.sep, "/"), hash.digest("hex"))
  }
  return Object.fromEntries([...files].toSorted(([left], [right]) => left.localeCompare(right)))
}

/** Execute the original hidden checks independently of the candidate's test scripts. */
export async function verify(
  item: CodingCase,
  directory: string,
  oracleDir: string,
  options: { timeoutMs?: number } = {},
): Promise<Verification> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS)
    throw new Error(`Oracle timeout must be between 1 and ${TIMEOUT_MS} ms`)
  const oracles = path.resolve(oracleDir)
  if (within(path.resolve(directory), oracles)) throw new Error("Oracle directory must be outside the fixture")
  const fixture = await realpath(directory)
  await mkdir(oracles, { recursive: true })
  if (within(fixture, await realpath(oracles))) throw new Error("Oracle directory must be outside the fixture")
  const oracle = path.join(oracles, `oracle-${crypto.randomUUID()}.ts`)
  // The trusted script emits this only after the oracle body completes. Candidate process.exit(0)
  // during import cannot substitute a success report for execution of the hidden checks.
  const receipt = `REDCODE_EVAL_COMPLETE:${crypto.randomUUID()}`
  await Bun.write(oracle, `${item.oracle}\nconsole.log(${JSON.stringify(receipt)})\n`)
  const started = performance.now()
  const child = Bun.spawn([process.execPath, oracle], {
    cwd: oracles,
    env: { PATH: process.env.PATH ?? "", HOME: oracles, USERPROFILE: oracles, REDCODE_EVAL_FIXTURE: fixture },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)
  const [stdout, stderr, exit] = await Promise.all([
    consume(child.stdout, OUTPUT_LIMIT_BYTES),
    consume(child.stderr, 0),
    child.exited,
  ]).finally(() => clearTimeout(timer))
  const durationMs = performance.now() - started
  await rm(oracle, { force: true })
  const lines = stdout.text.trimEnd().split(/\r?\n/)
  const completed = lines.at(-1) === receipt
  // Candidate logging precedes the oracle's final report; it is diagnostic output, not JSON.
  const parsed = decode((completed ? lines.at(-2) : lines.at(-1)) ?? "")
  const checks =
    stdout.bytes <= OUTPUT_LIMIT_BYTES &&
    Option.isSome(parsed) &&
    new Set(parsed.value.checks.map((check) => check.id)).size === parsed.value.checks.length
      ? parsed.value.checks
      : []
  const format = checks.length > 0
  const expected = new Set(item.checkIDs)
  const completeChecks =
    expected.size > 0 &&
    expected.size === item.checkIDs.length &&
    checks.length === expected.size &&
    checks.every((check) => expected.has(check.id))
  const failed = [
    ...(!format ? ["oracle_format"] : []),
    ...(!completed ? ["oracle_incomplete"] : []),
    ...(format && !completeChecks ? ["oracle_checks"] : []),
    ...(timedOut ? ["oracle_timeout"] : []),
    ...(exit !== 0 ? ["oracle_exit"] : []),
    ...checks.filter((check) => !check.pass).map((check) => check.id),
  ]
  return {
    pass: failed.length === 0,
    score:
      format && completed && completeChecks && !timedOut && exit === 0
        ? checks.filter((check) => check.pass).length / checks.length
        : 0,
    format,
    failed,
    checks,
    process: {
      exit,
      durationMs,
      stdoutBytes: stdout.bytes,
      stderrBytes: stderr.bytes,
      timedOut,
    },
  }
}

/** Passing hidden checks cannot compensate for no edit or changes outside the requested files. */
export function grade(
  item: CodingCase,
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
  verification: Verification,
) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file])
    .toSorted()
  const editable = new Set(item.editable)
  const scope = [
    ...(!changed.some((file) => editable.has(file)) ? ["no_edit"] : []),
    ...changed.filter((file) => !editable.has(file)).map((file) => `out_of_scope:${file}`),
  ]
  return {
    pass: verification.pass && scope.length === 0,
    score: scope.length ? 0 : verification.score,
    format: verification.format,
    failed: [...verification.failed, ...scope],
    changes: {
      added: changed.filter((file) => !Object.hasOwn(before, file)),
      modified: changed.filter((file) => Object.hasOwn(before, file) && Object.hasOwn(after, file)),
      deleted: changed.filter((file) => !Object.hasOwn(after, file)),
    },
  }
}

function within(directory: string, target: string) {
  const relative = path.relative(directory, target)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

async function consume(stream: ReadableStream<Uint8Array>, limit: number) {
  const buffer = Buffer.alloc(limit)
  let bytes = 0
  let stored = 0
  for await (const chunk of stream) {
    bytes += chunk.byteLength
    const count = Math.min(chunk.byteLength, limit - stored)
    if (count === 0) continue
    buffer.set(chunk.subarray(0, count), stored)
    stored += count
  }
  return { bytes, text: buffer.subarray(0, stored).toString("utf8") }
}

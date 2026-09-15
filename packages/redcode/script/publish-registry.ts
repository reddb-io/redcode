// Registry orchestration for publish.ts, kept free of side effects so it can be tested with a
// mocked npm runner. npm read replicas can lag a successful publish by many minutes, so every
// step here must be safe to repeat: rerunning a failed release job has to converge, not fail.
//
// npm also stages publishes that arrive through a 2FA-bypass token instead of publishing them
// (https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/).
// `npm publish` then prints success, `npm view` never serves the version, and every retry fails
// with E409 "Cannot publish over previously staged version". A staged version needs a maintainer's
// 2FA approval, so waiting or rerunning cannot fix it; this module reports it as its own failure.

export type RegistryPackage = {
  name: string
  version: string
  /** Packs and runs `npm publish` for this package. Throws when npm fails. */
  publish: () => Promise<void>
}

export type RegistryDeps = {
  /** Whether `npm view name@version` currently resolves. */
  published: (name: string, version: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
  log: (message: string) => void
}

export type VisibilityOptions = {
  timeoutMs: number
  initialDelayMs: number
  maxDelayMs: number
}

export const defaultVisibility: VisibilityOptions = {
  timeoutMs: 10 * 60_000,
  initialDelayMs: 5_000,
  maxDelayMs: 60_000,
}

export type PublishOutcome = "published" | "skipped" | "conflict" | "staged"

const conflictPatterns = [
  /\bE409\b/,
  /\b409 Conflict\b/i,
  /cannot publish over (?:the )?previously published versions?/i,
]

const stagedPatterns = [/previously staged versions?/i]

function errorText(error: unknown) {
  if (!error || typeof error !== "object") return String(error)
  const record = error as { message?: unknown; stderr?: unknown; stdout?: unknown }
  return [record.message, record.stderr, record.stdout, String(error)]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join("\n")
}

/** npm rejects republishing a version that is waiting in the staging area for maintainer approval. */
export function isStagedConflict(error: unknown) {
  const text = errorText(error)
  return stagedPatterns.some((pattern) => pattern.test(text))
}

/** npm rejects republishing an existing version with E409; that means the version is already live. */
export function isPublishConflict(error: unknown) {
  if (isStagedConflict(error)) return false
  const text = errorText(error)
  return conflictPatterns.some((pattern) => pattern.test(text))
}

export async function publishOnce(item: RegistryPackage, deps: RegistryDeps): Promise<PublishOutcome> {
  const spec = `${item.name}@${item.version}`
  if (await deps.published(item.name, item.version)) {
    deps.log(`already published ${spec}`)
    return "skipped"
  }
  try {
    await item.publish()
    return "published"
  } catch (error) {
    if (isStagedConflict(error)) {
      deps.log(`npm reports ${spec} is staged and waiting for maintainer approval (E409)`)
      return "staged"
    }
    if (!isPublishConflict(error)) throw error
    // The pre-check can miss a published version while registry reads lag behind writes.
    deps.log(`npm reports ${spec} was already published (E409); continuing`)
    return "conflict"
  }
}

export class VisibilityTimeoutError extends Error {
  constructor(
    readonly missing: string[],
    readonly waitedMs: number,
  ) {
    super(`npm registry did not serve ${missing.join(", ")} within ${Math.round(waitedMs / 1000)}s`)
    this.name = "VisibilityTimeoutError"
  }
}

export function npmPackageUrl(name: string) {
  return `https://www.npmjs.com/package/${name}`
}

/** A version npm accepted into its staging area; only a maintainer with 2FA can release it. */
export class StagedPublishError extends Error {
  constructor(
    readonly staged: Array<{ name: string; version: string }>,
    readonly blocked?: { name: string; version: string },
  ) {
    const lines = [
      `npm staged ${staged.length} package version(s) instead of publishing them; they need a maintainer's 2FA approval:`,
      ...staged.map((item) => `  - ${item.name}@${item.version}  ${npmPackageUrl(item.name)}`),
      'This is not registry lag: npm answered a republish with E409 "Cannot publish over previously staged version".',
      "To release them, a maintainer must:",
      "  1. Open each package page above, go to its Staged Packages tab, check the version and tarball, and approve it with 2FA",
      "     (or run `npm stage list <package>` then `npm stage approve <stage-id>`; `npm stage reject <stage-id>` discards it).",
      "  2. Rerun this job. Approved versions are skipped and publishing continues.",
      "To stop npm staging CI publishes, configure npm trusted publishing (OIDC) for every package; see https://docs.npmjs.com/trusted-publishers.",
    ]
    if (blocked)
      lines.splice(1 + staged.length, 0, `Not publishing ${blocked.name}@${blocked.version} until they are live.`)
    super(lines.join("\n"))
    this.name = "StagedPublishError"
  }
}

export async function waitForVisibility(
  items: Array<{ name: string; version: string }>,
  deps: RegistryDeps,
  options: VisibilityOptions = defaultVisibility,
) {
  const started = deps.now()
  const deadline = started + options.timeoutMs
  let delay = options.initialDelayMs
  let pending = items
  while (true) {
    const visible = await Promise.all(pending.map((item) => deps.published(item.name, item.version)))
    pending = pending.filter((_, index) => !visible[index])
    if (pending.length === 0) return
    const remaining = deadline - deps.now()
    const missing = pending.map((item) => `${item.name}@${item.version}`)
    if (remaining <= 0) throw new VisibilityTimeoutError(missing, deps.now() - started)
    const wait = Math.min(delay, remaining)
    deps.log(`waiting ${Math.round(wait / 1000)}s for npm to serve ${missing.join(", ")}`)
    await deps.sleep(wait)
    delay = Math.min(delay * 2, options.maxDelayMs)
  }
}

/**
 * Publishes every platform package, waits until npm serves all of them, and only then publishes
 * the main package, so it never resolves to optional dependencies the registry cannot serve yet.
 */
export async function publishRelease(
  input: { platforms: RegistryPackage[]; main: RegistryPackage },
  deps: RegistryDeps,
  options: VisibilityOptions = defaultVisibility,
) {
  const { platforms, main } = input
  const outcomes = await Promise.all(platforms.map((item) => publishOnce(item, deps)))
  // An E409 "previously staged" is authoritative: waiting cannot make a staged version visible.
  const stagedNow = platforms.filter((_, index) => outcomes[index] === "staged")
  if (stagedNow.length > 0) throw new StagedPublishError(stagedNow, main)

  try {
    await waitForVisibility(platforms, deps, options)
  } catch (error) {
    if (!(error instanceof VisibilityTimeoutError)) throw error
    // A token publish that npm silently staged looks exactly like registry lag until it is
    // republished: a staged version answers E409 "previously staged", a lagging one "previously
    // published". Probe every missing package once to tell the two apart.
    const missing = platforms.filter((item) => error.missing.includes(`${item.name}@${item.version}`))
    const probes = await Promise.all(missing.map((item) => publishOnce(item, deps)))
    const staged = missing.filter((_, index) => probes[index] === "staged")
    if (staged.length > 0) throw new StagedPublishError(staged, main)
    throw new Error(
      `${error.message}; not publishing ${main.name}@${main.version}. ` +
        `npm did not report the missing packages as staged, so this looks like registry lag. ` +
        `Rerun the failed job once the registry catches up; publishing is idempotent.`,
      { cause: error },
    )
  }

  const outcome = await publishOnce(main, deps)
  if (outcome === "staged") throw new StagedPublishError([main])
  return outcome
}

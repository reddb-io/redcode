// Registry orchestration for publish.ts, kept free of side effects so it can be tested with a
// mocked npm runner. npm read replicas can lag a successful publish by many minutes, so every
// step here must be safe to repeat: rerunning a failed release job has to converge, not fail.

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

export type PublishOutcome = "published" | "skipped" | "conflict"

const conflictPatterns = [
  /\bE409\b/,
  /\b409 Conflict\b/i,
  /cannot publish over (?:the )?previously published versions?/i,
]

function errorText(error: unknown) {
  if (!error || typeof error !== "object") return String(error)
  const record = error as { message?: unknown; stderr?: unknown; stdout?: unknown }
  return [record.message, record.stderr, record.stdout, String(error)]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join("\n")
}

/** npm rejects republishing an existing version with E409; that means the version is already live. */
export function isPublishConflict(error: unknown) {
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
  await Promise.all(input.platforms.map((item) => publishOnce(item, deps)))
  try {
    await waitForVisibility(input.platforms, deps, options)
  } catch (error) {
    if (!(error instanceof VisibilityTimeoutError)) throw error
    throw new Error(
      `${error.message}; not publishing ${input.main.name}@${input.main.version}. ` +
        `Rerun the failed job once the registry catches up; publishing is idempotent.`,
      { cause: error },
    )
  }
  return publishOnce(input.main, deps)
}

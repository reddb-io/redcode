import type { Session, Snapshot } from "./redskilled-client"

/**
 * Shares one Redskilled ACP session per directory between status reads. Each session is a whole
 * `red-skills-redskilled acp` process and clients poll status every few seconds, so a polled directory keeps one
 * adapter alive and closes it after `idleMs` without reads. A failed start or read closes the session and answers
 * reads in that directory with the same failure for `cooldownMs`, so a missing or broken installation is not
 * restarted on every poll.
 */
export function statusSessions(options: {
  create: (directory: string) => Promise<Session>
  idleMs?: number
  cooldownMs?: number
}) {
  const idle = options.idleMs ?? 30_000
  const cooldown = options.cooldownMs ?? 30_000
  const entries = new Map<string, Entry>()
  const failures = new Map<string, { until: number; error: Error }>()

  const evict = (directory: string, entry: Entry) => {
    if (entries.get(directory) === entry) entries.delete(directory)
    clearTimeout(entry.timer)
    entry.session.then(
      (session) => session.close(),
      () => undefined,
    )
  }

  return {
    async snapshot(directory: string): Promise<Snapshot> {
      const failure = failures.get(directory)
      if (failure && failure.until > Date.now()) throw failure.error
      const entry = entries.get(directory) ?? open(directory)
      clearTimeout(entry.timer)
      entry.reads++
      try {
        return await (await entry.session).snapshot()
      } catch (cause) {
        evict(directory, entry)
        failures.set(directory, { until: Date.now() + cooldown, error: cause instanceof Error ? cause : new Error(String(cause)) })
        throw cause
      } finally {
        entry.reads--
        if (entry.reads === 0 && entries.get(directory) === entry)
          entry.timer = setTimeout(() => evict(directory, entry), idle).unref()
      }
    },
    /** Starts the next read in `directory` from a fresh session, after a control or workflow operation changed it. */
    reset(directory: string) {
      failures.delete(directory)
      const entry = entries.get(directory)
      if (entry) evict(directory, entry)
    },
  }

  function open(directory: string) {
    const entry: Entry = { session: options.create(directory), reads: 0 }
    // Rejections surface through the read that awaits the session; this only avoids an unhandled rejection report.
    entry.session.catch(() => undefined)
    entries.set(directory, entry)
    return entry
  }
}

type Entry = { session: Promise<Session>; reads: number; timer?: Timer }

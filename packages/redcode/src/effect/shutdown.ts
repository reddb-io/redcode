/**
 * What must close before the process exits: registered by whoever opens something a hard exit
 * would leave behind — the app runtime, for its database connection — and run once from the exit
 * paths. Bounded, because a subprocess that ignores SIGTERM must never keep Redcode alive; the
 * database itself is safe either way (WAL), a clean close just leaves no WAL to replay.
 */
const disposers = new Set<() => Promise<unknown>>()

export const register = (dispose: () => Promise<unknown>) => {
  disposers.add(dispose)
}

export const run = async (timeoutMs = 3000) => {
  // Each disposer is started from a settled promise, so one that throws synchronously fails its
  // own entry instead of escaping `run` before the others have started.
  const pending = Array.from(disposers, (dispose) =>
    Promise.resolve()
      .then(() => dispose())
      .catch(() => undefined),
  )
  disposers.clear()
  if (pending.length === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    }),
  ])
  if (timer) clearTimeout(timer)
}

export * as Shutdown from "./shutdown"

export * as Teardown from "./teardown.js"

const entries = new Set<{ readonly label: string; readonly since: number }>()

/** Record shutdown work; call the returned function when it settles. */
export function track(label: string) {
  const entry = { label, since: Date.now() }
  entries.add(entry)
  return () => {
    entries.delete(entry)
  }
}

/** Pending work, oldest first, with its elapsed time. */
export function pending(now = Date.now()) {
  return Array.from(entries, (entry) => ({ label: entry.label, ms: now - entry.since }))
}

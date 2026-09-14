/**
 * Time a tool call spends waiting on a person, keyed by the call's ID.
 *
 * The tool deadline subtracts this so a call that asks something (plan_exit's approval, for one) is
 * not stopped as wedged while the user is still reading. In-flight waits count as they happen, since
 * the deadline is checked while the call is still running.
 */
const waits = new Map<string, { total: number; since: number[] }>()

export function start(callID: string, now = Date.now()) {
  const entry = waits.get(callID) ?? { total: 0, since: [] }
  entry.since.push(now)
  waits.set(callID, entry)
  return () => {
    const index = entry.since.indexOf(now)
    if (index === -1) return
    entry.since.splice(index, 1)
    entry.total += Date.now() - now
  }
}

export function waited(callID: string, now = Date.now()) {
  const entry = waits.get(callID)
  if (!entry) return 0
  return entry.total + entry.since.reduce((sum, since) => sum + (now - since), 0)
}

export function forget(callID: string) {
  waits.delete(callID)
}

export * as HumanWait from "./human-wait"

/** Small, client-local, demand-driven resource history. No transcripts or process arguments are stored. */
export type ResourcePoint = {
  x: number
  cpu: number | null
  memory: number | null
  free: number | null
  process: number | null
}

export const RETENTION = [0, 3_600_000, 21_600_000, 86_400_000] as const
export type Retention = (typeof RETENTION)[number]
const KEY = "redcode.resource-history.v1"
const MAX_HOSTS = 8
const MAX_POINTS = 1440
const MINUTE = 60_000
type History = { retention: Retention; hosts: Record<string, ResourcePoint[]> }
type HistoryStorage = Pick<Storage, "getItem" | "setItem">

function validPoint(value: ResourcePoint, now: number): boolean {
  return (
    !!value &&
    Number.isFinite(value.x) &&
    value.x <= now &&
    [value.cpu, value.memory, value.free, value.process].every(
      (item) => item === null || (Number.isFinite(item) && item >= 0),
    )
  )
}

function read(storage: HistoryStorage, now: number): History {
  try {
    const data = JSON.parse(storage.getItem(KEY) ?? "{}") as History
    const retention = RETENTION.includes(data.retention) ? data.retention : 3_600_000
    const entries = Object.entries(data.hosts ?? {})
      .slice(-MAX_HOSTS)
      .map(([key, points]) => [
        key,
        Array.isArray(points)
          ? points.filter((point) => validPoint(point, now) && point.x > now - retention).slice(-MAX_POINTS)
          : [],
      ])
    return { retention, hosts: Object.fromEntries(entries) }
  } catch {
    return { retention: 3_600_000, hosts: {} }
  }
}

function write(storage: HistoryStorage, history: History) {
  try {
    storage.setItem(KEY, JSON.stringify(history))
  } catch {
    /* Storage may be unavailable or full. */
  }
}

export function loadHistory(storage: HistoryStorage, host: string, now = Date.now()) {
  const history = read(storage, now)
  write(storage, history)
  return { retention: history.retention, points: history.hosts[host] ?? [] }
}

export function setHistoryRetention(storage: HistoryStorage, retention: Retention, now = Date.now()) {
  const history = read(storage, now)
  history.retention = RETENTION.includes(retention) ? retention : 0
  for (const [host, points] of Object.entries(history.hosts))
    history.hosts[host] = points.filter((point) => point.x > now - history.retention)
  write(storage, history)
  pruneExecutionHistory(storage, history.retention, now)
}

export function recordHistory(storage: HistoryStorage, host: string, point: ResourcePoint, now = Date.now()) {
  const history = read(storage, now)
  if (!history.retention || !validPoint(point, now)) return
  const points = history.hosts[host] ?? []
  const minute = Math.floor(point.x / MINUTE)
  if (points.length && Math.floor(points[points.length - 1]!.x / MINUTE) >= minute) return
  points.push(point)
  delete history.hosts[host]
  history.hosts[host] = points.slice(-MAX_POINTS)
  for (const key of Object.keys(history.hosts).slice(0, -MAX_HOSTS)) delete history.hosts[key]
  write(storage, history)
}

type ExecutionPoint = [number, number]
type ExecutionHistory = Record<string, Record<string, ExecutionPoint[]>>
const EXECUTION_KEY = "redcode.execution-memory.v1"
const EXECUTION_INTERVAL = 300_000
const MAX_EXECUTIONS = 32
const MAX_EXECUTION_POINTS = 288

function readExecutions(storage: HistoryStorage, retention: Retention, now: number): ExecutionHistory {
  try {
    const data = JSON.parse(storage.getItem(EXECUTION_KEY) ?? "{}") as ExecutionHistory
    return Object.fromEntries(
      Object.entries(data)
        .slice(-MAX_HOSTS)
        .map(([host, entries]) => [
          host,
          Object.fromEntries(
            Object.entries(entries)
              .slice(-MAX_EXECUTIONS)
              .map(([id, points]) => [
                id,
                Array.isArray(points)
                  ? points
                      .filter(
                        (point) =>
                          Array.isArray(point) &&
                          point.length === 2 &&
                          Number.isFinite(point[0]) &&
                          point[0] <= now &&
                          point[0] > now - retention &&
                          Number.isFinite(point[1]) &&
                          point[1] >= 0,
                      )
                      .slice(-MAX_EXECUTION_POINTS)
                  : [],
              ]),
          ),
        ]),
    )
  } catch {
    return {}
  }
}
function writeExecutions(storage: HistoryStorage, history: ExecutionHistory) {
  try {
    storage.setItem(EXECUTION_KEY, JSON.stringify(history))
  } catch {
    /* Storage may be unavailable or full. */
  }
}
function pruneExecutionHistory(storage: HistoryStorage, retention: Retention, now: number) {
  writeExecutions(storage, readExecutions(storage, retention, now))
}
export function executionHistory(storage: HistoryStorage, host: string, now = Date.now()) {
  const retention = read(storage, now).retention
  const history = readExecutions(storage, retention, now)
  writeExecutions(storage, history)
  return history[host] ?? {}
}
export function recordExecutions(
  storage: HistoryStorage,
  host: string,
  entries: ReadonlyArray<{ kind: string; id: string; residentBytes: number | null }>,
  now = Date.now(),
) {
  const retention = read(storage, now).retention
  if (!retention) return
  const history = readExecutions(storage, retention, now)
  const current = history[host] ?? {}
  for (const entry of entries.slice(0, MAX_EXECUTIONS)) {
    if (entry.residentBytes === null || !Number.isFinite(entry.residentBytes) || entry.residentBytes < 0) continue
    const id = `${entry.kind}:${entry.id}`
    const points = current[id] ?? []
    if (
      points.length &&
      Math.floor(points[points.length - 1]![0] / EXECUTION_INTERVAL) >= Math.floor(now / EXECUTION_INTERVAL)
    )
      continue
    points.push([now, entry.residentBytes])
    delete current[id]
    current[id] = points.slice(-MAX_EXECUTION_POINTS)
  }
  for (const key of Object.keys(current).slice(0, -MAX_EXECUTIONS)) delete current[key]
  delete history[host]
  history[host] = current
  for (const key of Object.keys(history).slice(0, -MAX_HOSTS)) delete history[key]
  writeExecutions(storage, history)
}

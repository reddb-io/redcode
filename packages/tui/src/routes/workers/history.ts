import type { RedskilledStatusResponse } from "@reddb-io/redcode-sdk/v2"
import { number, timestamp } from "./format"

export type Payload = NonNullable<RedskilledStatusResponse["payload"]>
export type Worker = Payload["workers"][number]

export type Sample = { at: number; tokens: number | null; tools: number | null }
export type ActivityKind = "start" | "phase" | "step" | "log" | "failed"
export type Activity = { at: number; kind: ActivityKind; text: string }

export type Track = {
  worker: Worker
  seen: number
  samples: Sample[]
  activity: Activity[]
}
export type Departed = Track & { ended: number }

export type History = {
  generated: string | undefined
  live: Record<string, Track>
  departed: Departed[]
}

export const LIMITS = { samples: 240, activity: 60, departed: 8 }

export function empty(): History {
  return { generated: undefined, live: {}, departed: [] }
}

/**
 * Fold one status payload into the client-side history. Pure: returns the same
 * object when nothing new arrived and a fresh object otherwise, so it can back
 * a Solid signal directly.
 */
export function record(history: History, payload: Payload | undefined, now: number): History {
  if (!payload) return history
  if (payload.generated_at === history.generated) return history

  const live: Record<string, Track> = {}
  const departed = history.departed.filter((item) => !payload.workers.some((w) => w.worker_id === item.worker.worker_id))

  for (const worker of payload.workers) {
    const previous = history.live[worker.worker_id] ?? history.departed.find((d) => d.worker.worker_id === worker.worker_id)
    const activity = previous ? [...previous.activity] : [start(worker, now)]
    if (previous) activity.push(...changes(previous.worker, worker, now))
    const samples = [...(previous?.samples ?? []), sample(worker, now)]
    live[worker.worker_id] = {
      worker,
      seen: now,
      samples: samples.slice(-LIMITS.samples),
      activity: activity.slice(-LIMITS.activity),
    }
  }

  for (const [id, track] of Object.entries(history.live)) {
    if (live[id]) continue
    departed.push({ ...track, ended: now })
  }
  departed.sort((a, b) => b.ended - a.ended)

  return { generated: payload.generated_at, live, departed: departed.slice(0, LIMITS.departed) }
}

function sample(worker: Worker, at: number): Sample {
  return { at, tokens: number(worker.display?.tokens), tools: number(worker.display?.tools) }
}

function start(worker: Worker, now: number): Activity {
  const at = timestamp(worker.started_at) ?? now
  const issue = worker.display?.issue ? ` on #${worker.display.issue}` : ""
  return { at, kind: "start", text: `started${issue}` }
}

function changes(before: Worker, after: Worker, at: number): Activity[] {
  const out: Activity[] = []
  const prev = before.display
  const next = after.display
  if (next?.phase && next.phase !== prev?.phase) {
    out.push({ at, kind: "phase", text: prev?.phase ? `phase ${prev.phase} → ${next.phase}` : `phase ${next.phase}` })
  }
  if (next?.step && next.step !== prev?.step) out.push({ at, kind: "step", text: `step ${next.step}` })
  if (next?.failed && !prev?.failed) out.push({ at, kind: "failed", text: "worker reported failure" })
  const line = after.log?.last_line?.trim()
  if (line && line !== before.log?.last_line?.trim()) out.push({ at, kind: "log", text: line })
  return out
}

/** Per-minute growth of a monotonic counter over the trailing window; null when unknowable. */
export function rate(samples: readonly Sample[], key: "tokens" | "tools", now: number, windowMs = 60_000) {
  const recent = samples.flatMap((item) => {
    const value = item[key]
    return item.at >= now - windowMs && value !== null ? [{ at: item.at, value }] : []
  })
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || first === last) return null
  const span = last.at - first.at
  if (span < 5_000) return null
  const delta = last.value - first.value
  if (delta < 0) return null
  return delta / (span / 60_000)
}

/**
 * Bucketed positive deltas of a counter, oldest first, covering only the buckets the
 * history actually spans (so a sparkline can pad the missing prefix).
 */
export function series(samples: readonly Sample[], key: "tokens" | "tools", count: number, bucketMs: number, now: number) {
  const first = samples[0]
  if (!first || count <= 0) return []
  const start = now - count * bucketMs
  const values = Array.from({ length: count }, () => 0)
  for (let index = 1; index < samples.length; index++) {
    const prev = samples[index - 1]
    const curr = samples[index]
    const before = prev[key]
    const after = curr[key]
    if (before === null || after === null) continue
    const delta = after - before
    if (delta <= 0) continue
    const bucket = Math.min(count - 1, Math.floor((curr.at - start) / bucketMs))
    if (bucket < 0) continue
    values[bucket] += delta
  }
  const covered = Math.floor((first.at - start) / bucketMs)
  return values.slice(Math.max(0, covered))
}

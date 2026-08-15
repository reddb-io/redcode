const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

export function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function formatBytes(value: unknown) {
  const bytes = number(value)
  if (bytes === null) return "?"
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)}K`
  if (bytes < 1024 ** 3) return `${trim((bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0))}M`
  return `${trim((bytes / 1024 ** 3).toFixed(1))}G`
}

export function formatDuration(value: unknown) {
  const ms = number(value)
  if (ms === null || ms < 0) return "?"
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export function formatCount(value: unknown) {
  const amount = number(value)
  if (amount === null) return "?"
  const abs = Math.abs(amount)
  if (abs < 1_000) return `${Math.round(amount)}`
  if (abs < 1_000_000) return `${trim((amount / 1_000).toFixed(abs < 10_000 ? 1 : 0))}k`
  if (abs < 1_000_000_000) return `${trim((amount / 1_000_000).toFixed(1))}M`
  return `${trim((amount / 1_000_000_000).toFixed(1))}B`
}

export function formatPercent(value: unknown) {
  const fraction = number(value)
  return fraction === null ? "?" : `${Math.round(fraction * 100)}%`
}

export function formatRate(perMinute: number | null, unit = "/m") {
  if (perMinute === null) return ""
  return `+${formatCount(perMinute)}${unit}`
}

function trim(value: string) {
  return value.endsWith(".0") ? value.slice(0, -2) : value
}

export function progress(index: unknown, total: unknown) {
  return `${number(index) ?? "?"}/${number(total) ?? "?"}`
}

export function fraction(index: unknown, total: unknown) {
  const done = number(index)
  const all = number(total)
  if (done === null || all === null || all <= 0) return null
  return Math.min(1, Math.max(0, done / all))
}

/** Solid block bar: `██████░░░░` — `null` renders as an empty track. */
export function bar(value: unknown, width: number) {
  const size = Math.max(1, Math.floor(width))
  const ratio = number(value)
  if (ratio === null) return "░".repeat(size)
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * size)
  return "█".repeat(filled) + "░".repeat(size - filled)
}

/** Sparkline over `values`, right-aligned to `width`; missing history pads with `·`. */
export function sparkline(values: readonly number[], width: number) {
  const size = Math.max(1, Math.floor(width))
  const tail = values.slice(-size)
  const max = tail.reduce((peak, item) => Math.max(peak, item), 0)
  const cells = tail.map((item) => {
    if (max <= 0 || item <= 0) return "▁"
    return BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((item / max) * BLOCKS.length))]
  })
  return "·".repeat(size - cells.length) + cells.join("")
}

export function timestamp(value: unknown) {
  if (typeof value !== "string") return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Milliseconds elapsed since an ISO timestamp, clamped at zero. */
export function age(value: unknown, now: number) {
  const at = timestamp(value)
  return at === null ? null : Math.max(0, now - at)
}

export function formatAge(ms: number | null) {
  if (ms === null) return "?"
  if (ms < 1_000) return "now"
  return formatDuration(ms)
}

export function clock(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function truncate(value: string, width: number) {
  if (width <= 0) return ""
  if (value.length <= width) return value
  if (width === 1) return "…"
  return `${value.slice(0, width - 1)}…`
}

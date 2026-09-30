import type { SystemInfo } from "@opencode/client"

/** One line of the System tab: a heading, or a labelled value. */
export type SystemLine = { readonly heading: string } | { readonly label: string; readonly value: string }

/** How often the System tab reads the server again while it is on screen; the numbers it shows drift slowly. */
export const SYSTEM_POLL_MS = 5_000

/** A size in bytes as people read it, in powers of 1024. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${exponent === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[exponent]}`
}

/** How long something has been up, in its two largest units. */
export function formatUptime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

/** The database as one description and the lines that belong to it. */
function database(info: SystemInfo["database"], counts: SystemInfo["counts"]): SystemLine[] {
  const rows = counts ? [{ label: "rows", value: `${counts.sessions} sessions · ${counts.messages} messages` }] : []
  if (info.kind === "remote")
    return [{ label: "type", value: `remote (${info.protocol})` }, { label: "host", value: info.host }, ...rows]
  if (info.kind === "memory") return [{ label: "type", value: "in memory, not saved" }, ...rows]
  return [
    { label: "type", value: "local (SQLite)" },
    { label: "path", value: info.path },
    {
      label: "size",
      value:
        info.size === undefined
          ? "unknown"
          : `${formatBytes(info.size)}${info.wal ? ` + ${formatBytes(info.wal)} log` : ""}`,
    },
    ...rows,
  ]
}

/** The System tab's content: what Redcode is, the server it talks to, its database and where its files live. */
export function systemLines(info: SystemInfo, now: number): SystemLine[] {
  return [
    { heading: "Redcode" },
    { label: "version", value: info.version },
    { label: "runtime", value: `${info.runtime} · ${info.platform}` },
    {
      label: "process",
      value: `pid ${info.pid} · up ${formatUptime(now - info.started)} · ${formatBytes(info.memory)}`,
    },
    ...info.urls.slice(0, 3).map((url) => ({ label: "url", value: url })),
    { heading: "Database" },
    ...database(info.database, info.counts),
    { heading: "Files" },
    { label: "config", value: info.paths.config },
    { label: "data", value: info.paths.data },
    { label: "state", value: info.paths.state },
    { label: "cache", value: info.paths.cache },
    { label: "logs", value: info.paths.log },
    { label: "tmp", value: info.paths.tmp },
  ]
}

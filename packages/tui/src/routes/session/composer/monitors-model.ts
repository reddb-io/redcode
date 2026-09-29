import type { MonitorPublicInfo } from "@opencode/client"
import { Monitor } from "@opencode/schema/monitor"

/** How often monitors are re-read while the Monitors tab is on screen and a monitor still runs; events cover the rest. */
export const MONITOR_POLL_MS = 2_000
/** The longest one-line result a row shows; the full evidence is one keypress away. */
export const SUMMARY_CHARS = 160

export type MonitorTone = "info" | "success" | "warning" | "error" | "muted"

const STATES = {
  running: { label: "running", tone: "info" },
  succeeded: { label: "succeeded", tone: "success" },
  failed: { label: "failed", tone: "error" },
  timed_out: { label: "timed out", tone: "warning" },
  cancelled: { label: "cancelled", tone: "muted" },
  interrupted: { label: "interrupted", tone: "warning" },
  expired: { label: "expired", tone: "muted" },
} satisfies Record<MonitorPublicInfo["status"], { label: string; tone: MonitorTone }>

const DELIVERIES = {
  pending: "delivery pending",
  observed: "returned inline",
  delivered: "delivered",
  failed: "delivery failed",
  suppressed: "not delivered",
} satisfies Record<MonitorPublicInfo["delivery"], string>

export function monitorState(status: MonitorPublicInfo["status"]) {
  return STATES[status]
}

export function monitorDelivery(delivery: MonitorPublicInfo["delivery"]) {
  return DELIVERIES[delivery]
}

/** Running monitors first, newest started first; finished ones after them, most recently settled first. */
export function sortMonitors(list: readonly MonitorPublicInfo[]) {
  return list.toSorted(
    (a, b) =>
      Number(b.status === "running") - Number(a.status === "running") ||
      (a.status === "running" ? b.created - a.created : b.updated - a.updated),
  )
}

export function runningMonitors(list: readonly MonitorPublicInfo[]) {
  return list.filter((info) => info.status === "running").length
}

/** The footer's label, or undefined when nothing runs so a session without live monitors shows nothing. */
export function monitorsIndicator(list: readonly MonitorPublicInfo[]) {
  const count = runningMonitors(list)
  if (count === 0) return undefined
  return `${count} ${count === 1 ? "monitor" : "monitors"}`
}

/** What a monitor watches, on one line: the polled command, or the probe label the runtime recorded. */
export function monitorTarget(info: MonitorPublicInfo) {
  return firstLine(info.command) || info.id
}

/** Time until a running monitor's deadline, or undefined once it has settled. */
export function timeLeft(info: MonitorPublicInfo, now: number) {
  if (info.status !== "running") return undefined
  const remaining = info.created + Monitor.deadline(info.options) - now
  if (remaining <= 0) return "deadline passed"
  return `${duration(remaining)} left`
}

/** The last result as one bounded line: what matched, else the error, else the last line of output. */
export function monitorSummary(info: MonitorPublicInfo) {
  const result =
    firstLine(info.evidence?.matched ?? "") ||
    firstLine(info.error ?? "") ||
    firstLine(info.evidence?.error ?? "") ||
    lastLine(info.evidence?.output ?? "")
  const text = `${checks(info.attempts)} · ${result || "no result yet"}`
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS - 1)}…` : text
}

/** The full evidence the former monitor dialog showed, made safe to print. */
export function monitorDetail(info: MonitorPublicInfo) {
  return Monitor.printable(
    [
      `${checks(info.attempts)} · ${info.options.mode === "poll" ? Monitor.schedule(info.options) : info.workdir}`,
      info.error,
      info.evidence?.matched ? `Matched: ${info.evidence.matched}` : undefined,
      info.evidence?.output || "No result yet.",
      info.evidence?.outputPath ? `Full output: ${info.evidence.outputPath}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n"),
  )
}

/** Monitors that were running in the previous read and have settled in the next one. */
export function finishedMonitors(previous: readonly MonitorPublicInfo[], next: readonly MonitorPublicInfo[]) {
  const running = new Set(previous.filter((info) => info.status === "running").map((info) => info.id))
  return next.filter((info) => running.has(info.id) && info.status !== "running")
}

/** A short toast for a monitor that settled while its tab was out of sight. */
export function finishToast(info: MonitorPublicInfo) {
  const state = monitorState(info.status)
  const target = monitorTarget(info)
  return {
    variant: state.tone === "muted" ? ("info" as const) : state.tone,
    message: `Monitor ${state.label}: ${target.length > 60 ? `${target.slice(0, 59)}…` : target}`,
  }
}

function checks(attempts: number) {
  return `${attempts} ${attempts === 1 ? "check" : "checks"}`
}

function firstLine(text: string) {
  return (
    Monitor.printable(text)
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .find((line) => line.length > 0) ?? ""
  )
}

function lastLine(text: string) {
  return (
    Monitor.printable(text)
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .findLast((line) => line.length > 0) ?? ""
  )
}

function duration(ms: number) {
  const seconds = Math.ceil(ms / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

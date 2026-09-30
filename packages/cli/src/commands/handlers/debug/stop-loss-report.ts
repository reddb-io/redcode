import { SessionGuard } from "@opencode/schema/session-guard"

/**
 * What the stop-loss log says about its own calibration: how often it acted, how often a signal was let through, and
 * how often the work moved after a hint. A high dismissed share points at signals that fire too easily; hints that are
 * rarely followed by progress point at hints that do not help.
 */
export function stopLossReport(
  entries: ReadonlyArray<{ readonly guard: string; readonly action: string; readonly subject?: string }>,
) {
  const trips = entries.filter((entry) => entry.guard === "stop_loss")
  const dismissed = trips.filter((entry) => entry.subject?.startsWith(SessionGuard.STOP_LOSS_DISMISSED)).length
  const progressed = trips.filter((entry) => entry.subject === SessionGuard.STOP_LOSS_PROGRESSED).length
  const hints = trips.filter((entry) => entry.action === "correct").length
  const stops = trips.filter((entry) => entry.action === "stop").length
  return { hints, stops, dismissed, progressed }
}

/** The lines `debug guards` prints for it, none when the stop-loss did nothing in the period. */
export function stopLossLines(report: ReturnType<typeof stopLossReport>) {
  const signals = report.hints + report.stops + report.dismissed
  if (signals === 0) return []
  const share = (part: number, whole: number) => (whole === 0 ? "" : ` (${Math.round((100 * part) / whole)}%)`)
  return [
    "Stop-loss:",
    `  signals checked     ${signals}`,
    `  let through by S1   ${report.dismissed}${share(report.dismissed, signals)}`,
    `  hints given         ${report.hints}`,
    `  hints then progress ${report.progressed}${share(report.progressed, report.hints)}`,
    `  turns stopped       ${report.stops}`,
  ]
}

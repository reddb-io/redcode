export * as AutomationSchedule from "./schedule.js"

import type { Automation } from "@opencode/schema/automation"
import { DateTime } from "effect"

/** Next instant strictly after `from`; calendar occurrences retain the schedule's wall-clock zone. */
export function next(schedule: Automation.Schedule, from: number): number | null {
  if (schedule.type === "once") return schedule.at > from ? schedule.at : null
  if (schedule.type === "interval") return from + schedule.everyMs
  const today = DateTime.toParts(DateTime.makeZonedUnsafe(from, { timeZone: schedule.timeZone }))
  const dates = Array.from({ length: 8 }, (_, offset) =>
    DateTime.toPartsUtc(
      DateTime.add(DateTime.makeUnsafe({ year: today.year, month: today.month, day: today.day }), { days: offset }),
    ),
  )
  return (
    dates
      .filter((date) => schedule.weekdays.includes(date.weekDay === 0 ? 7 : date.weekDay))
      .map((date) =>
        DateTime.toEpochMillis(
          DateTime.makeZonedUnsafe(
            {
              year: date.year,
              month: date.month,
              day: date.day,
              hour: Number(schedule.timeOfDay.slice(0, 2)),
              minute: Number(schedule.timeOfDay.slice(3)),
              second: 0,
              millisecond: 0,
            },
            {
              timeZone: schedule.timeZone,
              adjustForTimeZone: true,
              // Earlier occurrence in a repeated hour; shift forward by the gap for a nonexistent hour.
              disambiguation: "compatible",
            },
          ),
        ),
      )
      .find((instant) => instant > from) ?? null
  )
}

export function missed(schedule: Automation.Schedule, dueAt: number, now: number) {
  return schedule.type === "fixed_time" && now - dueAt > 600000
}

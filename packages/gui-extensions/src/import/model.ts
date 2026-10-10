/** The session a conflict names when the server reports the session as already imported. */
export function existingSession(error: unknown) {
  if (!(error instanceof Error) || error.name !== "ConflictError" || !("resource" in error)) return
  return typeof error.resource === "string" ? error.resource : undefined
}

/** Whether an import failed because the session's recorded folder does not exist on the server's machine. */
export function missingDirectory(error: unknown) {
  return error instanceof Error && error.name === "LocationNotFoundError"
}

const units = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const

/**
 * How long before `now` a time was, in the locale's words, such as "5 minutes ago" or "yesterday".
 *
 * @param time - The time, in epoch milliseconds.
 * @param now - The current time, in epoch milliseconds.
 * @param locale - The BCP 47 locale to word it in.
 */
export function ago(time: number, now: number, locale: string) {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const elapsed = Math.max(0, now - time)
  const unit = units.find((item) => elapsed >= item[1])

  if (!unit) return format.format(0, "second")

  return format.format(-Math.floor(elapsed / unit[1]), unit[0])
}

/**
 * A folder short enough for a list row: its last two segments after an ellipsis when it has more.
 *
 * @param directory - An absolute path, with either separator.
 */
export function shortFolder(directory: string) {
  const segments = directory.split(/[\\/]/).filter(Boolean)

  if (segments.length <= 2) return directory

  return `…/${segments.slice(-2).join("/")}`
}

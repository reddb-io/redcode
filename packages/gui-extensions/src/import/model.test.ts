import { describe, expect, test } from "bun:test"
import { ago, existingSession, missingDirectory, shortFolder } from "./model"

// The generated client rejects with an Error named after the server's tag and carrying the body's fields.
const declared = (body: Record<string, unknown> & { _tag: string; message: string }) =>
  Object.assign(new Error(body.message), body, { name: body._tag })

describe("import errors", () => {
  test("a conflict names the session imported earlier", () => {
    const error = declared({ _tag: "ConflictError", message: "Session already imported: ses_1", resource: "ses_1" })

    expect(existingSession(error)).toBe("ses_1")
    expect(missingDirectory(error)).toBe(false)
  })

  test("other failures name no session", () => {
    expect(existingSession(declared({ _tag: "ConflictError", message: "Busy" }))).toBeUndefined()
    expect(existingSession(declared({ _tag: "SessionNotFoundError", message: "Gone", resource: "ses_1" }))).toBe(
      undefined,
    )
    expect(existingSession("ConflictError")).toBeUndefined()
  })

  test("a missing folder is told apart, so the session can be imported elsewhere", () => {
    expect(missingDirectory(declared({ _tag: "LocationNotFoundError", message: "The session's directory…" }))).toBe(
      true,
    )
    expect(missingDirectory(new Error("Failed"))).toBe(false)
  })
})

describe("session rows", () => {
  const now = Date.UTC(2026, 9, 9, 12)

  test("word the update time relative to now", () => {
    expect(ago(now - 10_000, now, "en")).toBe("now")
    expect(ago(now - 5 * 60_000, now, "en")).toBe("5 minutes ago")
    expect(ago(now - 3 * 3_600_000, now, "en")).toBe("3 hours ago")
    expect(ago(now - 86_400_000, now, "en")).toBe("yesterday")
    expect(ago(now - 40 * 86_400_000, now, "en")).toBe("last month")
    // A clock behind the server never reads as the future.
    expect(ago(now + 60_000, now, "en")).toBe("now")
  })

  test("shorten folders to their last two segments", () => {
    expect(shortFolder("/Users/kit/code/redcode")).toBe("…/code/redcode")
    expect(shortFolder("C:\\Users\\kit\\code\\redcode")).toBe("…/code/redcode")
    expect(shortFolder("/srv/app")).toBe("/srv/app")
  })
})

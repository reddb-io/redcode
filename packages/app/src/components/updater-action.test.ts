import { describe, expect, test } from "bun:test"
import { updaterAction } from "./updater-action"

describe("updaterAction", () => {
  test("disables update actions when the platform has no updater", () => {
    expect(updaterAction(undefined)).toEqual({ label: "Check now" })
  })

  test("projects updater transitions into one settings action", () => {
    expect(updaterAction({ status: "idle" })).toEqual({
      label: "Check now",
      run: "check",
    })
    expect(updaterAction({ status: "checking" })).toEqual({ label: "Checking..." })
    expect(updaterAction({ status: "downloading", version: "2.0.0" })).toEqual({
      label: "Downloading...",
    })
    expect(updaterAction({ status: "ready", version: "2.0.0" })).toEqual({
      label: "Install and restart",
      run: "install",
    })
    expect(updaterAction({ status: "installing", version: "2.0.0" })).toEqual({
      label: "Installing...",
    })
  })
})

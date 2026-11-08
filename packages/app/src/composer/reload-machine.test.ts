import { describe, expect, test } from "bun:test"
import { createConfigReloadState, transitionConfigReload } from "./reload-machine"

describe("configuration reload lifecycle", () => {
  test("coalesces repeated requests while a reload is running", () => {
    const started = transitionConfigReload(createConfigReloadState(), { type: "reload.requested" })
    const repeated = transitionConfigReload(started.state, { type: "reload.requested" })

    expect(started.effects).toEqual([{ type: "toast.pending.show" }, { type: "reload.run", attempt: 1 }])
    expect(repeated.state).toBe(started.state)
    expect(repeated.effects).toEqual([])
  })

  test("ignores stale completion and reports the active result once", () => {
    const started = transitionConfigReload(createConfigReloadState(), { type: "reload.requested" })
    const stale = transitionConfigReload(started.state, { type: "reload.succeeded", attempt: 0 })
    const failed = transitionConfigReload(stale.state, {
      type: "reload.failed",
      attempt: 1,
      cause: "offline",
    })

    expect(stale.effects).toEqual([])
    expect(failed.state).toEqual({ status: "idle", issued: 1 })
    expect(failed.effects).toEqual([
      { type: "toast.pending.dismiss" },
      { type: "toast.failed", cause: "offline" },
    ])
  })
})

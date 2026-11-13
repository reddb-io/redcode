import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Context } from "@opencode/gui-extensions/sdk"
import { createReviewApi } from "./host-apis"

function fixture() {
  const extension = new AbortController()
  const signals: AbortSignal[] = []
  const removed: string[] = []
  const context: Pick<Context, "add" | "signal"> = {
    signal: extension.signal,
    add(_registry, item) {
      if (typeof item === "object" && item !== null && "signal" in item && item.signal instanceof AbortSignal)
        signals.push(item.signal)
      const id = typeof item === "object" && item !== null && "id" in item ? String(item.id) : "unknown"
      let active = true

      return () => {
        if (!active) return
        active = false
        removed.push(id)
      }
    },
  }

  return { context, extension, signals, removed }
}

describe("review extension API", () => {
  test("installation registers all contribution kinds and owner disposal removes and aborts them", () => {
    const state = fixture()
    const dispose = createRoot((dispose) => {
      const review = createReviewApi("fixture", state.context)
      review.lens({ id: "lens", title: "Lens" })
      review.annotations({ id: "annotations", title: "Annotations", load: () => [] })
      review.action({ id: "action", title: "Action", placement: "toolbar", run: () => undefined })

      return dispose
    })

    expect(state.signals.map((signal) => signal.aborted)).toEqual([false, false, false])
    dispose()
    expect(state.removed.toSorted()).toEqual(["action", "annotations", "lens"])
    expect(state.signals.map((signal) => signal.aborted)).toEqual([true, true, true])
  })

  test("an update retires the previous revision before the replacement contributes", () => {
    const state = fixture()
    const first = createRoot((dispose) => {
      createReviewApi("fixture", state.context).action({
        id: "revision-1",
        title: "First",
        placement: "file",
        run: () => undefined,
      })

      return dispose
    })
    first()
    const second = createRoot((dispose) => {
      createReviewApi("fixture", state.context).action({
        id: "revision-2",
        title: "Second",
        placement: "file",
        run: () => undefined,
      })

      return dispose
    })

    expect(state.removed).toEqual(["revision-1"])
    expect(state.signals.map((signal) => signal.aborted)).toEqual([true, false])
    second()
    expect(state.removed).toEqual(["revision-1", "revision-2"])
  })

  test("extension disable or removal aborts registrations made outside a component owner", () => {
    const state = fixture()
    createReviewApi("fixture", state.context).lens({ id: "detached", title: "Detached" })

    state.extension.abort()

    expect(state.removed).toEqual(["detached"])
    expect(state.signals[0]?.aborted).toBe(true)
  })
})

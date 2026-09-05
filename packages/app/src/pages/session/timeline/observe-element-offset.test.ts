import { afterAll, beforeAll, expect, test } from "bun:test"
import { type Virtualizer } from "@tanstack/solid-virtual"
import { mutationNodesContainElement, observeElementOffsetReconnectAware } from "./observe-element-offset"

// happy-dom schedules animation frames on its own terms, and under load it can starve them for
// seconds: the component waits for a frame to run its offset check, the test waits for the check,
// and on a Windows runner neither arrived inside the budget. Frames here are macrotasks, which
// happy-dom always drives, and the timestamp stays real so the component's own deadline
// arithmetic is untouched.
let restoreFrames: (() => void) | undefined

beforeAll(() => {
  const target = window as unknown as {
    requestAnimationFrame: (callback: FrameRequestCallback) => number
    cancelAnimationFrame: (handle: number) => void
  }
  const realRequest = target.requestAnimationFrame
  const realCancel = target.cancelAnimationFrame
  const pending = new Map<number, ReturnType<typeof setTimeout>>()
  let nextHandle = 1

  const request = (callback: FrameRequestCallback) => {
    const handle = nextHandle++
    pending.set(
      handle,
      setTimeout(() => {
        pending.delete(handle)
        callback(performance.now())
      }, 0),
    )
    return handle
  }
  const cancel = (handle: number) => {
    const timer = pending.get(handle)
    if (timer === undefined) return
    clearTimeout(timer)
    pending.delete(handle)
  }

  // Both bindings: the component reaches through `targetWindow`, the helpers below through the
  // global, and nothing guarantees those are the same object.
  target.requestAnimationFrame = request
  target.cancelAnimationFrame = cancel
  globalThis.requestAnimationFrame = request
  globalThis.cancelAnimationFrame = cancel

  restoreFrames = () => {
    target.requestAnimationFrame = realRequest
    target.cancelAnimationFrame = realCancel
    globalThis.requestAnimationFrame = realRequest
    globalThis.cancelAnimationFrame = realCancel
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
  }
})

afterAll(() => restoreFrames?.())

test("matches only the scroll element or an ancestor containing it", () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  const child = document.createElement("div")
  const sibling = document.createElement("div")
  route.append(viewport)
  viewport.append(child)

  expect(mutationNodesContainElement([viewport], viewport)).toBe(true)
  expect(mutationNodesContainElement([route], viewport)).toBe(true)
  expect(mutationNodesContainElement([child, sibling], viewport)).toBe(false)
})

// happy-dom decides for itself when a MutationObserver batch is delivered and in what order, and
// that scheduling is noise here: adding a console.log to the component was enough to flip this
// test between passing and failing, and it failed on Windows CI for the same reason. The reconnect
// tests therefore drive the observer themselves — each pins one arrangement a browser is allowed
// to produce — so what is under test is our reaction to it, not the emulator's timing.
function withObserver(
  deliver: (callback: MutationCallback, records: MutationRecord[], observer: MutationObserver) => void,
) {
  const real = window.MutationObserver
  class Controlled extends real {
    constructor(callback: MutationCallback) {
      super((records, observer) => deliver(callback, [...records], observer))
    }
  }
  ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = Controlled
  return () => {
    ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = real
  }
}

test("reports a divergent native offset once and ignores equal offsets and unrelated mutations", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  const unrelated = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 79_400,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 0,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  // Delivered as a browser reports it: every record of a batch, in order.
  const restoreObserver = withObserver((callback, records, observer) => callback(records, observer))
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  document.body.append(unrelated)
  unrelated.remove()
  await frames(2)
  expect(calls).toEqual([])

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  // Waited for rather than counted in frames: three frames is plenty on a quiet machine and not
  // enough on a loaded CI runner, and the difference has nothing to do with what is being tested.
  await until(() => calls.length > 0)
  expect(calls).toEqual([[0, false]])

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await frames(3)
  // Still one call: the offset now matches, so there is nothing new to report.
  expect(calls).toEqual([[0, false]])

  restoreObserver()
  cleanup?.()
  route.remove()
})

test("keeps checking until stale reset-delay callbacks can no longer win", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 79_400,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 20,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: number[] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => {
    calls.push(offset)
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await frames(1)
  expect(instance.scrollOffset).toBe(0)

  instance.scrollOffset = 79_400
  await new Promise((resolve) => setTimeout(resolve, 25))
  await frames(3)

  expect(instance.scrollOffset).toBe(0)
  expect(calls).toEqual([0, 0])
  cleanup?.()
  route.remove()
})

test.each([
  { name: "LTR", isRtl: false, expected: 240 },
  { name: "RTL", isRtl: true, expected: -240 },
])("reports the TanStack horizontal $name offset after reconnect", async ({ isRtl, expected }) => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  viewport.scrollLeft = 240
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: {
      horizontal: true,
      isRtl,
      isScrollingResetDelay: 0,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await frames(3)

  expect(calls).toEqual([[expected, false]])
  cleanup?.()
  route.remove()
})

test("cleanup suppresses an already queued delegated offset callback", async () => {
  const viewport = document.createElement("div")
  document.body.append(viewport)
  viewport.scrollTop = 100
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 10,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) =>
    calls.push([offset, isScrolling]),
  )

  viewport.dispatchEvent(new Event("scroll"))
  cleanup?.()
  await new Promise((resolve) => setTimeout(resolve, 25))

  expect(calls).toEqual([[100, true]])
  viewport.remove()
})

test("cleanup cancels reconnect checks and delegated offset observation", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 50,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: number[] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => calls.push(offset))

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  cleanup?.()
  instance.scrollOffset = 100
  viewport.dispatchEvent(new Event("scroll"))
  await frames(4)

  expect(calls).toEqual([])
  route.remove()
})

test("reconnects when the batch reports the addition before the removal", async () => {
  // A batch carrying both records can present them either way round, and reading them in order
  // meant the addition was judged while the removal had not been seen yet: the element came back
  // to the page with nothing watching its offset. This is the failing order, on purpose.
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 79_400,
    options: { horizontal: false, isRtl: false, isScrollingResetDelay: 0, useScrollendEvent: false },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []

  const real = window.MutationObserver
  class Reversed extends real {
    constructor(callback: MutationCallback) {
      super((records, observer) => callback([...records].reverse(), observer))
    }
  }
  ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = Reversed
  let cleanup: (() => void) | undefined
  try {
    cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
      calls.push([offset, isScrolling])
      instance.scrollOffset = offset
    })
    route.remove()
    document.body.append(route)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await frames(3)
    expect(calls).toEqual([[0, false]])
  } finally {
    ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = real
    cleanup?.()
    route.remove()
  }
})

/** Waits for a condition across animation frames, up to a generous deadline. */
test("reconnects when the addition is delivered in an earlier batch than the removal", async () => {
  // The cross-batch twin of the reversed-order case: nothing guarantees a batch carrying the
  // re-insertion arrives after the one carrying the removal.
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 79_400,
    options: { horizontal: false, isRtl: false, isScrollingResetDelay: 0, useScrollendEvent: false },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []

  const real = window.MutationObserver
  class OneBatchLate extends real {
    constructor(callback: MutationCallback) {
      // Every record is delivered in its own batch, in reverse order: addition first.
      super((records, observer) => {
        for (const record of [...records].reverse()) callback([record], observer)
      })
    }
  }
  ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = OneBatchLate
  let cleanup: (() => void) | undefined
  try {
    cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
      calls.push([offset, isScrolling])
      instance.scrollOffset = offset
    })
    route.remove()
    document.body.append(route)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await until(() => calls.length > 0)
    expect(calls).toEqual([[0, false]])
  } finally {
    ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = real
    cleanup?.()
    route.remove()
  }
})

async function until(condition: () => boolean, budgetMs = 2_000) {
  const deadline = Date.now() + budgetMs
  while (!condition() && Date.now() < deadline) {
    await frames(1)
    // A macrotask between frames: the observer's callback is delivered on one, and a loop of
    // nothing but animation frames can starve it.
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function frames(count: number) {
  for (let index = 0; index < count; index++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

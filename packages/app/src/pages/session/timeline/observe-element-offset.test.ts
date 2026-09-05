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

// happy-dom decides for itself whether a MutationObserver batch is delivered at all, in what order,
// and when — and under CI load it sometimes simply does not get round to it. Waiting on that was
// the difference between this suite passing here and failing on CI, twice, for two different
// reasons. So the reconnect tests hand the observer its records themselves: what is under test is
// how the component reacts to an arrangement a browser is allowed to produce, never the emulator's
// scheduling.
function captureObserver() {
  const real = window.MutationObserver
  let callback: MutationCallback | undefined
  const observed: { root: Node; options?: MutationObserverInit }[] = []
  class Captured extends real {
    constructor(fn: MutationCallback) {
      super(fn)
      callback = fn
    }
    observe(root: Node, options?: MutationObserverInit) {
      observed.push({ root, options })
      return super.observe(root, options)
    }
  }
  ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = Captured
  return {
    /** Deliver one batch, exactly as written. */
    emit(records: Partial<MutationRecord>[]) {
      callback?.(records.map(asRecord), {} as MutationObserver)
    },
    /** What the component actually asked the browser to watch. */
    observed,
    restore() {
      ;(window as unknown as { MutationObserver: typeof real }).MutationObserver = real
    },
  }
}

const asRecord = (input: Partial<MutationRecord>): MutationRecord =>
  ({
    type: "childList",
    target: document.body,
    addedNodes: [],
    removedNodes: [],
    ...input,
  }) as unknown as MutationRecord

const removedRecord = (node: Node) => asRecord({ removedNodes: [node] as unknown as NodeList })
const addedRecord = (node: Node) => asRecord({ addedNodes: [node] as unknown as NodeList })

test("watches the route above the scroll element, not the element itself", async () => {
  // The three tests below hand the observer its records, which is what makes them deterministic —
  // so this one keeps the other half honest: a component that never subscribed would pass them all.
  const route = document.createElement("main")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: { horizontal: false, isRtl: false, isScrollingResetDelay: 0, useScrollendEvent: false },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>

  const observer = captureObserver()
  const cleanup = observeElementOffsetReconnectAware(instance, () => {})
  try {
    expect(observer.observed).toHaveLength(1)
    // The nearest <main>, because a session route is replaced below it; the element itself would
    // be gone at exactly the moment we need to hear about it.
    expect(observer.observed[0]!.root).toBe(route)
    expect(observer.observed[0]!.options).toMatchObject({ childList: true, subtree: true })
  } finally {
    observer.restore()
    cleanup?.()
    route.remove()
  }
})

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
  const observer = captureObserver()
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  // Something else on the page came and went. It says nothing about our element.
  document.body.append(unrelated)
  unrelated.remove()
  observer.emit([addedRecord(unrelated), removedRecord(unrelated)])
  await frames(2)
  expect(calls).toEqual([])

  // Now the route is replaced, which is how a session route behaves, and the element comes back.
  route.remove()
  document.body.append(route)
  observer.emit([removedRecord(route), addedRecord(route)])
  await until(() => calls.length > 0)
  expect(calls).toEqual([[0, false]])

  route.remove()
  document.body.append(route)
  observer.emit([removedRecord(route), addedRecord(route)])
  await frames(3)
  // Still one call: the offset now matches what was reported, so there is nothing new to say.
  expect(calls).toEqual([[0, false]])

  observer.restore()
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

  const observer = captureObserver()
  let cleanup: (() => void) | undefined
  try {
    cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
      calls.push([offset, isScrolling])
      instance.scrollOffset = offset
    })
    route.remove()
    document.body.append(route)
    // One batch, addition first.
    observer.emit([addedRecord(route), removedRecord(route)])
    await until(() => calls.length > 0)
    expect(calls).toEqual([[0, false]])
  } finally {
    observer.restore()
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

  const observer = captureObserver()
  let cleanup: (() => void) | undefined
  try {
    cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
      calls.push([offset, isScrolling])
      instance.scrollOffset = offset
    })
    route.remove()
    document.body.append(route)
    // Two batches, the addition arriving in the earlier one.
    observer.emit([addedRecord(route)])
    observer.emit([removedRecord(route)])
    await until(() => calls.length > 0)
    expect(calls).toEqual([[0, false]])
  } finally {
    observer.restore()
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

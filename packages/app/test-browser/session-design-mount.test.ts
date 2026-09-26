import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { mountReview, type ReviewOptions } from "@reddb-io/redcode-design/review"
import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { stage } from "@reddb-io/redcode-design/stage"
import { previewLoading } from "@reddb-io/redcode-design/loading"
import { createSessionDesignMount } from "@/components/session/session-design-mount"

describe("Design review lifetime", () => {
  test("keeps an ongoing request alive across updates and aborts it on disposal", async () => {
    const started = Promise.withResolvers<AbortSignal | null | undefined>()
    const response = Promise.withResolvers<Response>()
    const fixture = createFixture((_url, init) => {
      started.resolve(init?.signal)
      return response.promise
    })
    try {
      fixture.module.resolve({ mountReview: fixture.mount })
      const signal = await started.promise
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)
      expect(fixture.element("status").textContent).toBe("Working…")

      expect(fixture.element("status").textContent).toBe(reviewCopy.busy)
      expect(signal?.aborted).toBe(false)
      expect(fixture.mounts()).toBe(1)
      expect(fixture.cleanups()).toBe(0)

      fixture.dispose()
      expect(signal?.aborted).toBe(true)
    } finally {
      fixture.dispose()
      response.reject(new DOMException("Fixture disposed", "AbortError"))
    }
    expect(fixture.cleanups()).toBe(1)
  })

  for (const order of ["before", "after"] as const) {
    test(`routes A between the session prompt and the review by focus (page handler registered ${order} mount)`, async () => {
      const fixture = createFixture()
      document.body.append(fixture.root)
      const page = order === "before" ? installSessionKeys() : undefined
      try {
        fixture.module.resolve({ mountReview: fixture.mount })
        await fixture.mounted[0].promise
        await new Promise((resolve) => setTimeout(resolve, 50))
        const keys = page ?? installSessionKeys()
        try {
          // Stand in for a loaded revision: the toggle only acts while the studio is on screen.
          fixture.element("studio").hidden = false
          fixture.element("review-tools").hidden = false
          const toggle = fixture.element("annotate")
          const host = fixture.root.firstElementChild as HTMLElement

          // (a) Nothing focused: the key goes to the prompt and annotation stays off.
          expect(keys.press("a").defaultPrevented).toBe(false)
          expect(document.activeElement).toBe(keys.prompt)
          expect(keys.prompt.value).toBe("a")
          expect(toggle.getAttribute("aria-pressed")).toBe("false")

          // (b) Clicking the review's panel background puts focus in the review, so A toggles annotation.
          keys.prompt.blur()
          fixture.element("panel-review").dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }))
          expect(document.activeElement).toBe(host)
          expect(keys.press("a").defaultPrevented).toBe(true)
          expect(toggle.getAttribute("aria-pressed")).toBe("true")
          expect(document.activeElement).toBe(host)
          expect(keys.prompt.value).toBe("a")
          keys.press("a")
          expect(toggle.getAttribute("aria-pressed")).toBe("false")
          expect(keys.prompt.value).toBe("a")

          // (c) Focus in the prompt: A is typed there.
          keys.prompt.focus()
          expect(keys.press("a").defaultPrevented).toBe(false)
          expect(keys.prompt.value).toBe("aa")
          expect(toggle.getAttribute("aria-pressed")).toBe("false")
        } finally {
          if (!page) keys.remove()
        }
      } finally {
        page?.remove()
        fixture.dispose()
        fixture.root.remove()
      }
    })
  }

  test("an open panel holds its review presence until it is disposed", async () => {
    const held: { sessionID: string; signal: AbortSignal }[] = []
    const fixture = createFixture(undefined, (options, signal) => held.push({ sessionID: options.sessionID, signal }))
    try {
      fixture.module.resolve({ mountReview: fixture.mount })
      await fixture.mounted[0].promise
      expect(held.map((item) => [item.sessionID, item.signal.aborted])).toEqual([["design_locale_fixture", false]])
      expect(held.length).toBe(1)
    } finally {
      fixture.dispose()
    }
    expect(held[0]!.signal.aborted).toBe(true)
  })

  test("does not mount after its owner is disposed during import", async () => {
    const fixture = createFixture()
    fixture.dispose()
    fixture.module.resolve({ mountReview: fixture.mount })
    await fixture.module.promise
    expect(fixture.mounts()).toBe(0)
    expect(fixture.cleanups()).toBe(0)
  })
})

/** Mirrors the session page: a document keydown that sends typed letters to the prompt unless handled or typed into a field. */
function installSessionKeys() {
  const prompt = document.createElement("textarea")
  document.body.append(prompt)
  const editable = (item: EventTarget | null | undefined) =>
    item instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(item.tagName) || item.isContentEditable)
  const deepActive = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement)
      current = current.shadowRoot.activeElement
    return current instanceof HTMLElement ? current : undefined
  }
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const target = event.composedPath().find((item): item is HTMLElement => item instanceof HTMLElement)
    if (editable(target) || editable(deepActive())) return
    if (event.key.length === 1 && !(event.ctrlKey || event.metaKey)) prompt.focus()
  }
  document.addEventListener("keydown", handler)
  return {
    prompt,
    /** Dispatches a key where the browser would (the focused element) and applies typing as its default action. */
    press(key: string) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true })
      ;(deepActive() ?? document.body).dispatchEvent(event)
      if (!event.defaultPrevented && key.length === 1 && deepActive() === prompt) prompt.value += key
      return event
    },
    remove() {
      document.removeEventListener("keydown", handler)
      prompt.remove()
    },
  }
}

function createFixture(
  request: ReviewOptions["request"] = async () => Response.json([]),
  presence?: Parameters<typeof createSessionDesignMount>[0]["presence"],
) {
  const root = document.createElement("div")
  const module = Promise.withResolvers<{ mountReview: typeof mountReview }>()
  const mounted = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
  const counts = { loads: 0, mounts: 0, cleanups: 0 }
  const mount: typeof mountReview = (host, options) => {
    const cleanup = mountReview(host, options)
    mounted[counts.mounts++]?.resolve()
    return Object.assign(
      () => {
        counts.cleanups++
        cleanup()
      },
      { updateCopy: cleanup.updateCopy },
    )
  }
  return createRoot((dispose) => {
    createSessionDesignMount({
      root,
      load: () => {
        counts.loads++
        return module.promise
      },
      options: () => ({
        base: "http://design-fixture.invalid",
        sessionID: "design_locale_fixture",
        stage,
        loading: previewLoading,
        request,
      }),
      presence,
    })
    return {
      root,
      module,
      mounted,
      mount,
      dispose,
      element: <T extends HTMLElement>(id: string) => root.firstElementChild!.shadowRoot!.getElementById(id) as T,
      text: () => root.firstElementChild?.shadowRoot?.querySelector("#new")?.textContent,
      loads: () => counts.loads,
      mounts: () => counts.mounts,
      cleanups: () => counts.cleanups,
    }
  })
}

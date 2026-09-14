import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { mountReview, type ReviewOptions } from "@reddb-io/redcode-design/review"
import { createSessionDesignMount } from "@/components/session/session-design-mount"
import { designGoalDictionary } from "@/i18n/design-goal"
import type { DesktopNativeLocale } from "@/i18n/desktop-native"

describe("Design review translations and lifetime", () => {
  test("updates translations in place while preserving the intake and preview frames", async () => {
    const fixture = createFixture()
    try {
      fixture.module.resolve({ mountReview: fixture.mount })
      await fixture.mounted[0].promise
      expect(fixture.text()).toBe("Create design")
      const name = fixture.element<HTMLInputElement>("name")
      const objective = fixture.element<HTMLTextAreaElement>("objective")
      const engine = fixture.element<HTMLSelectElement>("engine")
      const preview = fixture.element<HTMLIFrameElement>("preview")
      const board = fixture.element<HTMLIFrameElement>("board-frame")
      name.value = "Minha interface"
      objective.value = "Preservar o que estou escrevendo"
      engine.value = "solid"

      fixture.locale("br")
      expect(fixture.text()).toBe("Criar design")
      expect(fixture.element("name")).toBe(name)
      expect(fixture.element("objective")).toBe(objective)
      expect(fixture.element("engine")).toBe(engine)
      expect(name.value).toBe("Minha interface")
      expect(objective.value).toBe("Preservar o que estou escrevendo")
      expect(engine.value).toBe("solid")
      expect(fixture.element("preview")).toBe(preview)
      expect(fixture.element("board-frame")).toBe(board)
      expect(preview.title).toBe(designGoalDictionary("br")["session.design.studio.review"])
      expect(board.title).toBe(designGoalDictionary("br")["session.design.studio.whiteboard"])
      expect(fixture.element("designs").getAttribute("aria-label")).toBe(
        designGoalDictionary("br")["session.design.studio.alternatives"],
      )
      expect(fixture.cleanups()).toBe(0)

      fixture.locale("fr")
      expect(fixture.text()).toBe("Create design")
      fixture.locale("de")
      expect(fixture.mounts()).toBe(1)
      expect(fixture.loads()).toBe(1)
    } finally {
      fixture.dispose()
    }
    expect(fixture.cleanups()).toBe(1)
  })

  test("keeps an ongoing request alive across a locale change and aborts it on disposal", async () => {
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

      fixture.locale("br")
      expect(fixture.element("status").textContent).toBe(designGoalDictionary("br")["session.design.studio.busy"])
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

  test("uses the latest locale when the studio import resolves later", async () => {
    const fixture = createFixture()
    try {
      fixture.locale("br")
      fixture.module.resolve({ mountReview: fixture.mount })
      await fixture.mounted[0].promise
      expect(fixture.text()).toBe("Criar design")
      expect(fixture.mounts()).toBe(1)
      expect(fixture.loads()).toBe(1)
    } finally {
      fixture.dispose()
    }
    expect(fixture.cleanups()).toBe(1)
  })

  test("keeps the annotation shortcut scoped to the review so the prompt still gets typed letters", async () => {
    const fixture = createFixture()
    const outside = document.createElement("button")
    document.body.append(outside, fixture.root)
    try {
      fixture.module.resolve({ mountReview: fixture.mount })
      await fixture.mounted[0].promise
      await new Promise((resolve) => setTimeout(resolve, 50))
      // Stand in for a loaded revision: the toggle only acts while the studio is on screen.
      fixture.element("studio").hidden = false
      fixture.element("review-tools").hidden = false
      const toggle = fixture.element("annotate")
      const press = () => {
        const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true, composed: true })
        document.body.dispatchEvent(event)
        return event
      }
      const pointer = (target: Element) =>
        target.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }))

      // Nothing has been touched yet: the key is left for the session page.
      expect(press().defaultPrevented).toBe(false)
      expect(toggle.getAttribute("aria-pressed")).toBe("false")
      pointer(outside)
      expect(press().defaultPrevented).toBe(false)
      expect(toggle.getAttribute("aria-pressed")).toBe("false")

      pointer(fixture.element("canvas"))
      expect(press().defaultPrevented).toBe(true)
      expect(toggle.getAttribute("aria-pressed")).toBe("true")

      pointer(outside)
      expect(press().defaultPrevented).toBe(false)
      expect(toggle.getAttribute("aria-pressed")).toBe("true")
    } finally {
      fixture.dispose()
      outside.remove()
      fixture.root.remove()
    }
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

function createFixture(request: ReviewOptions["request"] = async () => Response.json([])) {
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
    const [state, setState] = createStore<{ locale: DesktopNativeLocale }>({ locale: "en" })
    createSessionDesignMount({
      root,
      load: () => {
        counts.loads++
        return module.promise
      },
      options: () => ({
        base: "http://design-fixture.invalid",
        sessionID: "design_locale_fixture",
        request,
      }),
      translate: (key) => designGoalDictionary(state.locale)[key],
    })
    return {
      root,
      module,
      mounted,
      mount,
      dispose,
      locale: (locale: DesktopNativeLocale) => setState("locale", locale),
      element: <T extends HTMLElement>(id: string) => root.firstElementChild!.shadowRoot!.getElementById(id) as T,
      text: () => root.firstElementChild?.shadowRoot?.querySelector("#new")?.textContent,
      loads: () => counts.loads,
      mounts: () => counts.mounts,
      cleanups: () => counts.cleanups,
    }
  })
}

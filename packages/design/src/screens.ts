/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/**
 * Declarative screens and the `design` helper, serialized into the prototype before its own scripts
 * run (preview) or as an init script (audit). Keep this function self-contained.
 *
 * Elements marked data-design-screen="id" are the pages of one flow. Each variant root (or the
 * document, when there are no variants) shows exactly one of its screens; the others are hidden by
 * a constructed stylesheet, so the prototype's DOM and a framework's tree are never touched.
 */
export function screens() {
  if ((window as { __designScreens?: boolean }).__designScreens) return
  ;(window as { __designScreens?: boolean }).__designScreens = true
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  const state = {
    /** Current screen per scope: a variant id, or "" for screens outside any variant. */
    current: new Map<string, string>(),
    manifest: "",
    params: undefined as Record<string, Record<string, unknown>> | undefined,
    listeners: [] as { id: string; run: (fields: Record<string, unknown>, meta: { reset: boolean }) => void }[],
  }
  const sheet = new CSSStyleSheet()
  // Until a screen is chosen every screen stays hidden, so a page never flashes all its steps at once.
  sheet.replaceSync("[data-design-screen]{display:none!important}")
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

  const scopeOf = (node: Element) => {
    const root = node.closest<HTMLElement>("[data-design-variant]")
    const id = root?.dataset.designVariant ?? ""
    return ID.test(id) ? id : ""
  }
  const list = () => {
    const seen = new Set<string>()
    return [...document.querySelectorAll<HTMLElement>("[data-design-screen]")].flatMap((node) => {
      const id = node.dataset.designScreen ?? ""
      if (!ID.test(id) || node.parentElement?.closest("[data-design-screen]")) return []
      const variant = scopeOf(node)
      if (seen.has(`${variant} ${id}`)) return []
      seen.add(`${variant} ${id}`)
      return [{ id, name: (node.dataset.designLabel || id).slice(0, 100), variant }]
    })
  }
  const paint = () => {
    const shown = [...state.current].map(([variant, id]) =>
      variant
        ? `[data-design-variant="${variant}"] [data-design-screen="${id}"]`
        : `[data-design-screen="${id}"]:not([data-design-variant] *)`,
    )
    sheet.replaceSync(`[data-design-screen]${shown.length ? `:not(${shown.join(",")})` : ""}{display:none!important}`)
  }
  const announce = () => {
    const items = list()
    const scopes = new Set(items.map((item) => item.variant))
    for (const variant of [...state.current.keys()]) if (!scopes.has(variant)) state.current.delete(variant)
    const hash = decodeURIComponent(location.hash.slice(1))
    for (const variant of scopes) {
      const own = items.filter((item) => item.variant === variant)
      if (own.some((item) => item.id === state.current.get(variant))) continue
      state.current.set(variant, (own.find((item) => item.id === hash) ?? own[0]).id)
    }
    paint()
    const current = Object.fromEntries(state.current)
    const manifest = JSON.stringify([items, current])
    if (manifest === state.manifest) return
    state.manifest = manifest
    if (parent !== window) parent.postMessage({ type: "design:screens", screens: items, current }, "*")
  }
  /** Shows a screen in one variant, or in every scope that has it when no variant is named. */
  const go = (id: unknown, variant?: unknown, scroll = true) => {
    if (typeof id !== "string" || !ID.test(id)) return false
    announce()
    const scopes = [
      ...new Set(
        list()
          .filter((item) => item.id === id && (typeof variant !== "string" || item.variant === variant))
          .map((item) => item.variant),
      ),
    ]
    for (const scope of scopes) {
      const previous = state.current.get(scope) ?? ""
      if (previous === id) continue
      state.current.set(scope, id)
      paint()
      window.dispatchEvent(new CustomEvent("design:screen", { detail: { screen: id, previous, variant: scope } }))
    }
    if (scopes.length) {
      if (scroll) scrollTo(0, 0)
      announce()
    }
    return scopes.length > 0
  }

  const api = {
    go: (screen: string, variant?: string) => go(screen, variant),
    screen: (variant?: string) =>
      state.current.get(variant ?? "") ?? (variant === undefined ? ([...state.current.values()][0] ?? "") : ""),
    screens: () => list(),
    state: (component: string, fields: Record<string, unknown>) =>
      window.dispatchEvent(new CustomEvent("design:state", { detail: { values: { [component]: fields } } })),
    params: {
      /** Runs now with the current values when they are known, and again on every change. */
      on: (component: string, run: (fields: Record<string, unknown>, meta: { reset: boolean }) => void) => {
        const listener = { id: component, run }
        state.listeners.push(listener)
        const fields = state.params?.[component]
        if (fields) run(structuredClone(fields), { reset: false })
        return () => {
          state.listeners = state.listeners.filter((item) => item !== listener)
        }
      },
      get: (component: string) => structuredClone(state.params?.[component] ?? {}),
    },
  }
  Object.defineProperty(window, "design", { value: api, configurable: true, writable: true })

  window.addEventListener("design:params", (event) => {
    if (!(event instanceof CustomEvent) || !event.detail?.values || typeof event.detail.values !== "object") return
    state.params = { ...state.params, ...structuredClone(event.detail.values) }
    for (const listener of state.listeners) {
      const fields = event.detail.values[listener.id]
      if (!fields || typeof fields !== "object") continue
      try {
        listener.run(structuredClone(fields), { reset: event.detail.reset === true })
      } catch (error) {
        // One broken listener must not stop the others; the error still reaches the console.
        setTimeout(() => {
          throw error
        })
      }
    }
  })
  window.addEventListener("design:state", (event) => {
    if (!(event instanceof CustomEvent) || !event.detail?.values || typeof event.detail.values !== "object") return
    const next = { ...state.params }
    for (const [component, fields] of Object.entries(event.detail.values as Record<string, unknown>))
      if (fields && typeof fields === "object") next[component] = { ...next[component], ...fields }
    state.params = next
  })
  window.addEventListener("design:go", (event) => {
    if (event instanceof CustomEvent) go(event.detail?.screen, event.detail?.variant)
  })
  window.addEventListener("hashchange", () => go(decodeURIComponent(location.hash.slice(1))))
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "design:screen") return
    go(
      event.data.id,
      typeof event.data.variant === "string" ? event.data.variant : undefined,
      event.data.scroll !== false,
    )
  })
  // Bubble phase: annotation and component picking stop the click earlier, and a prototype handler
  // that calls preventDefault (for example on invalid input) keeps the reader on the current screen.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const trigger = event.target.closest<HTMLElement>("[data-design-go], a[href^='#']")
    if (!trigger) return
    const id = trigger.dataset.designGo ?? decodeURIComponent(trigger.getAttribute("href")!.slice(1))
    const variant = scopeOf(trigger)
    const known = list()
    const scope = known.some((item) => item.id === id && item.variant === variant)
      ? variant
      : known.some((item) => item.id === id && item.variant === "")
        ? ""
        : undefined
    if (scope === undefined) return
    event.preventDefault()
    go(id, scope)
  })
  new MutationObserver(announce).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-design-screen", "data-design-label", "data-design-variant"],
  })
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce)
  else announce()
}

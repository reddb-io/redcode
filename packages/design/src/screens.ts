/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/**
 * Declarative screens and the `design` helper, serialized into the prototype before its own scripts
 * run (preview, export, approved side of a compare) or as an init script (audit). Keep this function
 * self-contained.
 *
 * Elements marked data-design-screen="id" are the pages of one flow. Each variant root (or the page,
 * outside variants) shows exactly one of its screens; the others are hidden by a constructed
 * stylesheet, so a framework's tree is never restructured. A screen inside another screen is part of
 * that screen, a screen attribute on a variant root is ignored, and a repeated id stays hidden.
 *
 * The runtime lives at window.__redcodeDesign, which redcode's own tooling uses. window.design is a
 * friendly alias only when the prototype has not defined that global itself.
 */
export function screens() {
  const HANDLE = "__redcodeDesign"
  if (Object.prototype.hasOwnProperty.call(window, HANDLE)) return
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  const SCREEN = "[data-design-screen]:not([data-design-variant])"
  /** Screens that take part: not on a variant root and not inside another screen. */
  const TOP = `${SCREEN}:not(${SCREEN} *)`
  const REPEAT = "data-design-screen-repeat"
  const state = {
    /** Current screen per scope: a variant id, or "" for screens outside any variant. */
    current: new Map<string, string>(),
    manifest: "",
    css: "",
    queued: false,
    /** Every screen shown at once, as the PDF export of a deck prints them. */
    all: false,
    params: undefined as Record<string, Record<string, unknown>> | undefined,
    listeners: [] as { id: string; run: (fields: Record<string, unknown>, meta: { reset: boolean }) => void }[],
    /**
     * Who moved last: the reader ("user": a key, a link, the URL) or the host ("command"), and the
     * number of the host's last command. Both ride on every announcement, so a host can tell a move
     * made here from the report of its own command, even one that crossed a newer command in flight.
     */
    origin: "command" as "user" | "command",
    seq: 0,
  }
  const sheet = new CSSStyleSheet()
  const style = (text: string) => {
    if (text === state.css) return
    state.css = text
    sheet.replaceSync(text)
  }
  // Until a screen is chosen every screen stays hidden, so a page never flashes all its steps at once.
  style(`${TOP},[${REPEAT}]{display:none!important}`)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

  /** A malformed fragment such as #50%off is read as written instead of throwing. */
  const fragment = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const hash = () => fragment(location.hash.slice(1))
  const scopeOf = (node: Element) => {
    const root = node.closest<HTMLElement>("[data-design-variant]")
    const id = root?.dataset.designVariant ?? ""
    return ID.test(id) ? id : ""
  }
  const nodes = () => [...document.querySelectorAll<HTMLElement>(TOP)]
  const list = () => {
    const seen = new Set<string>()
    return nodes().flatMap((node) => {
      const id = node.dataset.designScreen ?? ""
      if (!ID.test(id)) return []
      const variant = scopeOf(node)
      const repeat = seen.has(`${variant} ${id}`)
      if (repeat !== node.hasAttribute(REPEAT)) {
        if (repeat) node.setAttribute(REPEAT, "")
        else node.removeAttribute(REPEAT)
      }
      if (repeat) return []
      seen.add(`${variant} ${id}`)
      return [{ id, name: (node.dataset.designLabel || id).slice(0, 100), variant }]
    })
  }
  const find = (scope: string, id: string) =>
    nodes().find((node) => node.dataset.designScreen === id && scopeOf(node) === scope && !node.hasAttribute(REPEAT))
  const paint = () => {
    if (state.all) return style(`[${REPEAT}]{display:none!important}`)
    const shown = [...state.current].map(([variant, id]) =>
      variant
        ? `[data-design-variant="${variant}"] [data-design-screen="${id}"]`
        : `[data-design-screen="${id}"]:not([data-design-variant] *)`,
    )
    style(`${TOP}${shown.length ? `:not(${shown.join(",")})` : ""},[${REPEAT}]{display:none!important}`)
  }
  const announce = () => {
    const items = list()
    const scopes = new Set(items.map((item) => item.variant))
    for (const variant of [...state.current.keys()]) if (!scopes.has(variant)) state.current.delete(variant)
    for (const variant of scopes) {
      const own = items.filter((item) => item.variant === variant)
      if (own.some((item) => item.id === state.current.get(variant))) continue
      state.current.set(variant, (own.find((item) => item.id === hash()) ?? own[0]).id)
    }
    paint()
    const current = Object.fromEntries(state.current)
    const manifest = JSON.stringify([items, current])
    if (manifest === state.manifest) return
    state.manifest = manifest
    if (parent !== window)
      parent.postMessage({ type: "design:screens", screens: items, current, origin: state.origin, seq: state.seq }, "*")
  }
  /** Coalesces a burst of mutations, such as a framework mounting a tree, into one announcement. */
  const schedule = () => {
    if (state.queued) return
    state.queued = true
    queueMicrotask(() => {
      state.queued = false
      announce()
    })
  }
  const resetScroll = (target: HTMLElement | undefined) => {
    scrollTo(0, 0)
    for (let node = target?.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
        node.scrollTop = 0
        return
      }
    }
  }
  /**
   * Shows a screen in one variant, or in every scope that has it when no variant is named. A variant
   * without that screen falls back to a page-level screen of the same id.
   */
  const go = (
    id: unknown,
    variant?: unknown,
    options: { scroll?: boolean; focus?: boolean; history?: boolean; origin?: "user" | "command"; seq?: number } = {},
  ) => {
    if (typeof id !== "string" || !ID.test(id)) return false
    // Announces what changed before this move with the origin it had, then records who makes this one.
    announce()
    state.origin = options.origin ?? "user"
    if (options.seq !== undefined) state.seq = options.seq
    const items = list()
    const has = (scope: string) => items.some((item) => item.id === id && item.variant === scope)
    const scopes =
      typeof variant === "string"
        ? has(variant)
          ? [variant]
          : has("")
            ? [""]
            : []
        : [...new Set(items.filter((item) => item.id === id).map((item) => item.variant))]
    if (!scopes.length) return false
    for (const scope of scopes) {
      const previous = state.current.get(scope) ?? ""
      if (previous === id) continue
      state.current.set(scope, id)
      paint()
      window.dispatchEvent(new CustomEvent("design:screen", { detail: { screen: id, previous, variant: scope } }))
    }
    announce()
    const targets = scopes.flatMap((scope) => find(scope, id) ?? [])
    const target = targets.find((node) => node.getClientRects().length > 0) ?? targets[0]
    if (options.scroll !== false) resetScroll(target)
    if (options.focus && target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1")
      target.focus({ preventScroll: true })
    }
    if (options.history && hash() !== id) {
      // A standalone page gets a Back entry; a framed preview only mirrors the screen in its URL.
      try {
        if (parent === window) history.pushState(null, "", `#${id}`)
        else history.replaceState(null, "", `#${id}`)
      } catch {}
    }
    return true
  }

  const api = {
    go: (screen: string, variant?: string) => go(screen, variant, { focus: true, history: true }),
    /** Opens a screen for tooling: no focus move and no history entry. */
    open: (screen: string, variant?: string) => go(screen, variant, { origin: "command" }),
    screen: (variant?: string) =>
      state.current.get(variant ?? "") ?? (variant === undefined ? ([...state.current.values()][0] ?? "") : ""),
    screens: () => list(),
    current: () => Object.fromEntries(state.current),
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
  Object.defineProperty(window, HANDLE, { value: api, configurable: true })
  // A prototype that declares its own design global keeps it; a later `var design = …` simply replaces the alias.
  if ("design" in window)
    console.warn("window.design is already defined by the prototype; the design helper is window.__redcodeDesign.")
  else Object.defineProperty(window, "design", { value: api, configurable: true, writable: true })

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
  // Printing a deck shows every slide, one per page; tooling dispatches this before it prints.
  window.addEventListener("design:print", (event) => {
    state.all = !(event instanceof CustomEvent) || event.detail?.all !== false
    paint()
  })
  window.addEventListener("design:go", (event) => {
    if (event instanceof CustomEvent) go(event.detail?.screen, event.detail?.variant, { focus: true, history: true })
  })
  /** Follows the URL: a screen id opens it; an empty fragment, as after Back to the start, opens each first screen. */
  const follow = () => {
    const id = hash()
    if (id) {
      go(id)
      return
    }
    const firsts = new Map<string, string>()
    for (const item of list()) if (!firsts.has(item.variant)) firsts.set(item.variant, item.id)
    for (const [variant, first] of firsts) go(first, variant)
  }
  window.addEventListener("hashchange", follow)
  window.addEventListener("popstate", follow)
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "design:screen") return
    const seq = event.data.seq
    go(event.data.id, typeof event.data.variant === "string" ? event.data.variant : undefined, {
      scroll: event.data.scroll !== false,
      origin: "command",
      seq: typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined,
    })
  })
  const navigate = (event: Event, trigger: HTMLElement) => {
    const id = trigger.dataset.designGo ?? fragment(trigger.getAttribute("href")?.slice(1) ?? "")
    if (!ID.test(id)) return
    const variant = scopeOf(trigger)
    if (!list().some((item) => item.id === id && (item.variant === variant || item.variant === ""))) return
    event.preventDefault()
    go(id, variant, { focus: true, history: true })
  }
  // Window, bubble phase: this runs after the prototype's own handlers, including ones delegated from
  // document (Solid, jQuery), so preventDefault in any of them keeps the reader on the current screen.
  // Annotation and component picking stop the click before it gets here.
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const trigger = event.target.closest<HTMLElement>("[data-design-go], a[href^='#']")
    if (!trigger) return
    // A submit button inside a form navigates when the form submits, after the browser's validation.
    if (
      trigger.hasAttribute("data-design-go") &&
      (trigger instanceof HTMLButtonElement || trigger instanceof HTMLInputElement) &&
      trigger.form &&
      trigger.type === "submit"
    )
      return
    navigate(event, trigger)
  })
  window.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter
    if (submitter instanceof HTMLElement && submitter.hasAttribute("data-design-go")) navigate(event, submitter)
  })
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-design-screen", "data-design-label", "data-design-variant"],
  })
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce)
  else announce()
  // The host keeps the frame out of sight until it has painted with its fonts, so it never shows a blank page.
  const ready = () =>
    void (document.fonts?.ready ?? Promise.resolve()).then(() =>
      requestAnimationFrame(() => {
        if (parent !== window) parent.postMessage({ type: "design:ready" }, "*")
      }),
    )
  if (document.readyState === "complete") ready()
  else window.addEventListener("load", ready, { once: true })
}

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/** Where a presenter window stands: the slide on screen and when the talk started (0 until it has). */
export interface Show {
  readonly slide: string
  readonly started: number
}

/** What the audience and presenter windows of one deck say to each other over their BroadcastChannel. */
export type ShowMessage =
  | { readonly type: "hello" }
  | { readonly type: "goto"; readonly slide: string }
  | { readonly type: "state"; readonly slide: string; readonly started: number }
  | { readonly type: "reset"; readonly started: number }

/**
 * The deck logic every slide surface shares: which slide a key moves to, and how the audience and
 * presenter windows reconcile what they tell each other. Pure and self-contained, because the preview,
 * the review page and the presenter serialize it with `toString()`.
 */
export function deck() {
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  /**
   * The slide index a key moves to from `index` in a deck of `count` slides, or undefined when the key
   * does not navigate. Forward: →, ↓, Page Down, Space; back: ←, ↑, Page Up, Shift+Space; Home and End
   * jump to the first and last slide. The ends do not wrap.
   */
  const step = (input: { readonly key: string; readonly shift?: boolean }, index: number, count: number) => {
    if (count < 1) return undefined
    const last = count - 1
    const at = Math.min(Math.max(index, 0), last)
    const space = input.key === " " || input.key === "Spacebar"
    if (input.key === "Home") return 0
    if (input.key === "End") return last
    if ((space && input.shift) || ["ArrowLeft", "ArrowUp", "PageUp"].includes(input.key)) return Math.max(at - 1, 0)
    if (space || ["ArrowRight", "ArrowDown", "PageDown"].includes(input.key)) return Math.min(at + 1, last)
    return undefined
  }
  /**
   * Applies one message from another window of the show. A goto moves to its slide; a state (the answer
   * to a hello) moves there too and adopts the talk's start when this window has none yet; a reset
   * restarts the timer. A hello is answered with this window's state once it knows its slide. Anything
   * malformed leaves the show as it is.
   */
  const sync = (show: Show, message: unknown): { show: Show; changed: boolean; reply?: ShowMessage } => {
    const same = { show, changed: false }
    if (!message || typeof message !== "object") return same
    const data = message as Record<string, unknown>
    if (data.type === "hello")
      return show.slide ? { ...same, reply: { type: "state", slide: show.slide, started: show.started } } : same
    const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : -1)
    if (data.type === "reset") {
      const started = time(data.started)
      return started < 0 || started === show.started ? same : { show: { ...show, started }, changed: true }
    }
    if (data.type !== "goto" && data.type !== "state") return same
    if (typeof data.slide !== "string" || !ID.test(data.slide)) return same
    const started = data.type === "state" && !show.started && time(data.started) > 0 ? time(data.started) : show.started
    if (data.slide === show.slide && started === show.started) return same
    return { show: { slide: data.slide, started }, changed: true }
  }
  /** Elapsed time as m:ss, or h:mm:ss from the first hour. */
  const clock = (milliseconds: number) => {
    const total = Math.max(0, Math.floor(milliseconds / 1000))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = String(total % 60).padStart(2, "0")
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`
  }
  return { step, sync, clock }
}

/**
 * The slide runtime of a presentation, serialized into the prototype before the screen runtime (preview,
 * export, audit and PDF). Every top-level `<section class="slide">` becomes a screen of the screen
 * runtime: its own data-design-screen when it has one, else its id when that is a valid screen id, else
 * slide-N; its label is the slide number and first heading. A slide is a fixed 1920×1080 canvas, scaled
 * to fit a window of another size; its `<aside class="notes">` speaker notes stay hidden and reach the
 * host in a design:slides message. Arrow keys, Space, Page Up/Down, Home and End move between slides.
 * In print (the PDF export) every slide is one 1920×1080 page, after the host dispatches design:print.
 */
export function slides(logic: typeof deck) {
  const HANDLE = "__redcodeSlides"
  if (Object.prototype.hasOwnProperty.call(window, HANDLE)) return
  Object.defineProperty(window, HANDLE, { value: true })
  const WIDTH = 1920
  const HEIGHT = 1080
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  const SLIDE = "section.slide"
  const navigation = logic()
  const state = { queued: false, notes: "" }
  const sheet = new CSSStyleSheet()
  // Author styles come first in the cascade, so these win at equal specificity; print resets whatever
  // layout the page gave the deck around its slides so each one lands on its own page.
  sheet.replaceSync(
    `@page{size:${WIDTH}px ${HEIGHT}px;margin:0}html,body{margin:0;padding:0}${SLIDE}{box-sizing:border-box;position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}${SLIDE} aside.notes{display:none!important}@media screen{html[data-slide-fit],html[data-slide-fit] body{overflow:hidden;background:#000}html[data-slide-fit] ${SLIDE}{position:fixed;left:0;top:0;transform:translate(var(--slide-x),var(--slide-y)) scale(var(--slide-scale));transform-origin:0 0}}@media print{html,body{margin:0!important;padding:0!important;display:block!important;height:auto!important;overflow:visible!important}${SLIDE}{margin:0!important;transform:none!important;break-inside:avoid;break-after:page}${SLIDE}:last-of-type{break-after:auto}}`,
  )
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

  const scopeOf = (node: Element) => node.closest<HTMLElement>("[data-design-variant]")?.dataset.designVariant ?? ""
  const all = () =>
    [...document.querySelectorAll<HTMLElement>(SLIDE)].filter((node) => !node.parentElement?.closest(SLIDE))
  /** Marks unmarked slides as screens, numbered within their variant, and reports their notes. */
  const mark = () => {
    const taken = new Set(all().flatMap((node) => node.dataset.designScreen ?? []))
    const numbers = new Map<string, number>()
    for (const node of all()) {
      const scope = scopeOf(node)
      const number = (numbers.get(scope) ?? 0) + 1
      numbers.set(scope, number)
      if (!node.dataset.designScreen) {
        const own = ID.test(node.id) && !taken.has(node.id) ? node.id : ""
        const fallback = [
          `slide-${number}`,
          ...Array.from({ length: 50 }, (_, index) => `slide-${number}-${index + 2}`),
        ]
        const id = own || fallback.find((item) => !taken.has(item)) || `slide-${number}`
        taken.add(id)
        node.dataset.designScreen = id
      }
      // A label of the slide's own stays; the runtime's follows the heading, which can arrive after the section.
      if (!node.dataset.designLabel || node.dataset.designLabel === node.dataset.slideLabel) {
        const heading = node.querySelector("h1, h2, h3")?.textContent?.replace(/\s+/g, " ").trim() ?? ""
        const label = `${number}${heading ? `. ${heading}` : ""}`.slice(0, 100)
        node.dataset.slideLabel = label
        if (node.dataset.designLabel !== label) node.dataset.designLabel = label
      }
    }
    const notes = all().map((node) => ({
      id: node.dataset.designScreen ?? "",
      variant: scopeOf(node),
      notes: [...node.querySelectorAll("aside.notes")]
        .map((aside) => (aside.textContent ?? "").replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8000),
    }))
    const text = JSON.stringify(notes)
    if (text === state.notes) return
    state.notes = text
    if (parent !== window) parent.postMessage({ type: "design:slides", slides: notes }, "*")
  }
  const schedule = () => {
    if (state.queued) return
    state.queued = true
    queueMicrotask(() => {
      state.queued = false
      mark()
    })
  }
  /** Scales the canvas to fit a window that is not 1920×1080, centered on black; a 1920×1080 frame is left alone. */
  const fit = () => {
    const root = document.documentElement
    if (!root) return
    const scale = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT)
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.001) {
      delete root.dataset.slideFit
      return
    }
    root.dataset.slideFit = ""
    root.style.setProperty("--slide-scale", String(scale))
    root.style.setProperty("--slide-x", `${(innerWidth - WIDTH * scale) / 2}px`)
    root.style.setProperty("--slide-y", `${(innerHeight - HEIGHT * scale) / 2}px`)
  }
  type Runtime = {
    go?: (screen: string, variant?: string) => boolean
    screen?: (variant?: string) => string
    screens?: () => { id: string; variant: string }[]
  }
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.matches("input, textarea, select") ||
        (event.key === " " && target.matches("button, a[href], summary")))
    )
      return
    const api = (window as unknown as { __redcodeDesign?: Runtime }).__redcodeDesign
    if (typeof api?.screens !== "function" || typeof api.screen !== "function" || typeof api.go !== "function") return
    const items = api.screens()
    // The deck on screen: the first visible variant that has slides, else the slides outside variants.
    const scope =
      [...new Set(items.map((item) => item.variant))].find(
        (variant) =>
          variant &&
          [...document.querySelectorAll<HTMLElement>("[data-design-variant]")].some(
            (node) => node.dataset.designVariant === variant && node.getClientRects().length > 0,
          ),
      ) ?? ""
    const list = items.filter((item) => item.variant === scope)
    const next = navigation.step(
      { key: event.key, shift: event.shiftKey },
      list.findIndex((item) => item.id === api.screen!(scope)),
      list.length,
    )
    if (next === undefined) return
    event.preventDefault()
    api.go(list[next].id, scope || undefined)
  })
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "id", "data-design-screen"],
    characterData: true,
  })
  addEventListener("resize", fit)
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => {
      mark()
      fit()
    })
  else {
    mark()
    fit()
  }
}

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/** Where a presentation window stands: the slide on screen and when the talk started (0 until it has). */
export interface Show {
  readonly slide: string
  readonly started: number
  /** Lamport time of the navigation that put the show on its slide; 0 until a window moves. */
  readonly time: number
  /** The window behind that time, which breaks ties between equal times; "" until a window moves or answers. */
  readonly from: string
}

/**
 * What the audience and presenter windows of one deck say to each other over their BroadcastChannel.
 * Every message names its sender; a goto and a state carry the (time, from) stamp that orders them.
 */
export type ShowMessage =
  | { readonly type: "hello"; readonly sender: string }
  | {
      readonly type: "goto"
      readonly slide: string
      readonly time: number
      readonly from: string
      readonly sender: string
    }
  | {
      readonly type: "state"
      readonly slide: string
      readonly started: number
      readonly time: number
      readonly from: string
      readonly sender: string
    }
  | { readonly type: "reset"; readonly started: number; readonly sender: string }

/** One presentation window: its show, its slide frame as far as it knows, and its loop guard. */
export interface Presenting {
  /** This window's random id, the sender of its messages. */
  readonly self: string
  readonly show: Show
  /** The deck's slides as the frame announced them, in the variant on screen. */
  readonly slides: readonly { readonly id: string; readonly name: string }[]
  /** The frame has announced its slides once; later announcements can only be moves made inside it. */
  readonly ready: boolean
  /** The number of the last command sent to the slide frame. */
  readonly seq: number
  /** The slide the frame shows as far as this window knows. */
  readonly shown: string
  /** The highest Lamport time seen, counting the moves ignored while sync is paused. */
  readonly clock: number
  /** When the recent navigations that no key or click in this window made happened. */
  readonly recent: readonly number[]
  /** Too many of those in a second: the window stops following the others and its frame. */
  readonly paused: boolean
}

/** What happens to a presentation window. */
export type PresentEvent =
  /** A message from another window of the show. */
  | { readonly type: "channel"; readonly message: unknown; readonly now: number }
  /** A design:screens announcement of the slide frame, its slides already read in the variant on screen. */
  | {
      readonly type: "frame"
      readonly slides: readonly { readonly id: string; readonly name: string }[]
      readonly current: unknown
      readonly origin: unknown
      readonly seq: unknown
      readonly now: number
    }
  /** A key or a presenter button of this window moves to a slide. */
  | { readonly type: "move"; readonly slide: string }
  /** A key or a click reached this window. */
  | { readonly type: "input" }

/**
 * The deck logic every slide surface shares: which slide a key moves to, and how the audience and
 * presenter windows and their slide frames agree on one slide. Pure and self-contained, because the
 * preview, the review page and the presenter serialize it with `toString()`.
 *
 * Two rules keep the windows from echoing each other forever. A window follows its slide frame only
 * for a move the reader made inside it after the frame took the window's latest command, never for the
 * frame's report of a command. A window applies a goto only when it is newer than the move it shows,
 * by Lamport time and then sender id, and never passes on what it received.
 */
export function deck() {
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  // A loop runs at message speed, hundreds of moves a second; a held arrow key repeats about 30 times.
  const LOOP = { limit: 50, span: 1000 }
  /**
   * The slide index a key moves to from `index` in a deck of `count` slides, or undefined when the key
   * does not navigate. Forward: →, ↓, Page Down, Space; back: ←, ↑, Page Up, Shift+Space; Home and End
   * jump to the first and last slide. The ends neither wrap nor bounce: back on the first slide, forward
   * on the last one and a jump to the slide on screen are no move at all.
   */
  const step = (input: { readonly key: string; readonly shift?: boolean }, index: number, count: number) => {
    if (count < 1) return undefined
    const last = count - 1
    const at = Math.min(Math.max(index, 0), last)
    const space = input.key === " " || input.key === "Spacebar"
    const back = (space && input.shift) || ["ArrowLeft", "ArrowUp", "PageUp"].includes(input.key)
    const forward = space || ["ArrowRight", "ArrowDown", "PageDown"].includes(input.key)
    const next = input.key === "Home" ? 0 : input.key === "End" ? last : back ? at - 1 : forward ? at + 1 : undefined
    if (next === undefined || next < 0 || next > last || next === index) return undefined
    return next
  }
  /** The slide index a presenter button moves to, or undefined when it has nowhere to go and is disabled. */
  const button = (which: "previous" | "next", index: number, count: number) =>
    index < 0 ? undefined : step({ key: which === "next" ? "ArrowRight" : "ArrowLeft" }, index, count)
  /** Whether a (time, from) stamp is newer than the one of a show. */
  const newer = (time: number, from: string, than: { readonly time: number; readonly from: string }) =>
    time > than.time || (time === than.time && from > than.from)
  /**
   * Applies one message from another window of the show. A goto moves to its slide when it is newer
   * than the move this window shows; a state (the answer to a hello) does the same, and gives its talk's
   * start to a window that has none yet; a reset restarts the timer. A hello is answered with this
   * window's state once it knows its slide. A window's own messages, and anything malformed, change
   * nothing.
   */
  const sync = (show: Show, message: unknown, self: string): { show: Show; changed: boolean; reply?: ShowMessage } => {
    const same = { show, changed: false }
    if (!message || typeof message !== "object") return same
    const data = message as Record<string, unknown>
    // BroadcastChannel does not deliver a window's own posts, but a second channel or a relay could.
    if (typeof data.sender !== "string" || !ID.test(data.sender) || data.sender === self) return same
    if (data.type === "hello") {
      if (!show.slide) return same
      // A window that never moved claims its place, so a new window takes it and two new windows settle on one.
      const claimed = show.from ? show : { ...show, from: self }
      return {
        show: claimed,
        changed: false,
        reply: {
          type: "state",
          slide: claimed.slide,
          started: claimed.started,
          time: claimed.time,
          from: claimed.from,
          sender: self,
        },
      }
    }
    const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : -1)
    if (data.type === "reset") {
      const started = time(data.started)
      return started < 0 || started === show.started ? same : { show: { ...show, started }, changed: true }
    }
    if (data.type !== "goto" && data.type !== "state") return same
    if (typeof data.slide !== "string" || !ID.test(data.slide)) return same
    const at = time(data.time)
    if (!Number.isInteger(at) || at < 0 || typeof data.from !== "string" || !ID.test(data.from)) return same
    const started = data.type === "state" && !show.started && time(data.started) > 0 ? time(data.started) : show.started
    const next = newer(at, data.from, show)
      ? { ...show, slide: data.slide, started, time: at, from: data.from }
      : { ...show, started }
    return { show: next, changed: next.slide !== show.slide || next.started !== show.started }
  }
  /**
   * Counts one navigation that no key or click in this window made. More than the limit within a
   * second is a loop: the window pauses sync until the next key or click.
   */
  const guard = (recent: readonly number[], now: number) => {
    const kept = [...recent.filter((time) => time <= now && now - time < LOOP.span), now]
    return { recent: kept, paused: kept.length > LOOP.limit }
  }
  /** A new window, on the slide its link names ("" when none) and with the talk started at `started`. */
  const start = (self: string, slide: string, started: number): Presenting => ({
    self,
    show: { slide: ID.test(slide) ? slide : "", started, time: 0, from: "" },
    slides: [],
    ready: false,
    seq: 0,
    shown: "",
    clock: 0,
    recent: [],
    paused: false,
  })
  /** Moves this window to a slide of its deck and tells the others, stamped after every move it has seen. */
  const navigate = (host: Presenting, slide: string): { host: Presenting; post?: ShowMessage; draw: boolean } => {
    if (slide === host.show.slide || !host.slides.some((item) => item.id === slide)) return { host, draw: false }
    const time = Math.max(host.show.time, host.clock) + 1
    return {
      host: { ...host, clock: time, show: { ...host.show, slide, time, from: host.self } },
      post: { type: "goto", slide, time, from: host.self, sender: host.self },
      draw: true,
    }
  }
  /**
   * Applies one event to a window. The result says what to post to the other windows, if anything, and
   * whether to redraw; a redraw sends the frame its next command (see `command`). Nothing received is
   * ever posted on.
   */
  const update = (host: Presenting, event: PresentEvent): { host: Presenting; post?: ShowMessage; draw: boolean } => {
    if (event.type === "move") return navigate(host, event.slide)
    if (event.type === "input") {
      if (!host.paused) return { host: host.recent.length ? { ...host, recent: [] } : host, draw: false }
      // Resuming asks the other windows where the show went meanwhile; the newest answer wins.
      return { host: { ...host, recent: [], paused: false }, post: { type: "hello", sender: host.self }, draw: true }
    }
    if (event.type === "channel") return receive(host, event.message, event.now)
    return follow(host, event)
  }
  const receive = (host: Presenting, message: unknown, now: number) => {
    const data = message && typeof message === "object" ? (message as Record<string, unknown>) : {}
    const moving =
      (data.type === "goto" || data.type === "state") && typeof data.time === "number" && Number.isFinite(data.time)
    const clock = moving ? Math.max(host.clock, data.time as number) : host.clock
    if (host.paused && moving) return { host: { ...host, clock }, draw: false }
    const result = sync(host.show, message, host.self)
    const next = { ...host, clock, show: result.show }
    if (result.show.slide === host.show.slide) return { host: next, post: result.reply, draw: result.changed }
    const guarded = guard(host.recent, now)
    if (guarded.paused) return { host: { ...host, clock, recent: guarded.recent, paused: true }, draw: true }
    return { host: { ...next, recent: guarded.recent }, draw: true }
  }
  const follow = (host: Presenting, event: Extract<PresentEvent, { type: "frame" }>) => {
    const slides = event.slides
    const known = (id: unknown): id is string => typeof id === "string" && slides.some((item) => item.id === id)
    if (!slides.length) return { host: { ...host, slides }, draw: false }
    if (!host.ready) {
      // First announcement: the slide the link or another window asked for, else the frame's own.
      const slide = known(host.show.slide) ? host.show.slide : known(event.current) ? event.current : slides[0].id
      const shown = known(event.current) ? event.current : ""
      return { host: { ...host, slides, ready: true, shown, show: { ...host.show, slide } }, draw: true }
    }
    // An announcement sent before the frame took this window's latest command is settled by that command.
    if (typeof event.seq !== "number" || event.seq < host.seq) return { host: { ...host, slides }, draw: true }
    const synced = { ...host, slides, shown: known(event.current) ? event.current : host.shown }
    // Only a move the reader made inside the frame leads the show; the report of a command never does.
    if (host.paused || event.origin !== "user" || !known(event.current) || event.current === host.show.slide)
      return { host: synced, draw: true }
    const guarded = guard(host.recent, event.now)
    if (guarded.paused) return { host: { ...synced, recent: guarded.recent, paused: true }, draw: true }
    return navigate({ ...synced, recent: guarded.recent }, event.current)
  }
  /**
   * The design:screen command that puts the slide frame on the show's slide, numbered so the frame's
   * later announcements say which commands it had taken; none when the frame is known to be there.
   */
  const command = (
    host: Presenting,
  ): { host: Presenting; message?: { type: "design:screen"; id: string; seq: number } } => {
    const slide = host.show.slide
    if (!host.ready || slide === host.shown || !host.slides.some((item) => item.id === slide)) return { host }
    const seq = host.seq + 1
    return { host: { ...host, seq, shown: slide }, message: { type: "design:screen", id: slide, seq } }
  }
  /** Elapsed time as m:ss, or h:mm:ss from the first hour. */
  const clock = (milliseconds: number) => {
    const total = Math.max(0, Math.floor(milliseconds / 1000))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = String(total % 60).padStart(2, "0")
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`
  }
  return { step, button, sync, guard, start, update, command, clock }
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
  window.addEventListener("resize", fit)
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

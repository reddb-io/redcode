/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { ReviewCopy } from "./copy"
import type { deck, PresentEvent } from "./slides"
import type { stage } from "./stage"

export interface PresentOptions {
  /** The design routes' base, such as /api/session/<id>/design. */
  endpoint: string
  designID: string
  /** audience shows the slide alone; presenter shows the current and next slide, the notes and a timer. */
  view: "audience" | "presenter"
  /** The revision to present; the design's latest one by default. */
  revision?: string
  copy: ReviewCopy
  /** Deck logic from ./slides, passed in because this function is serialized on its own. */
  deck: typeof deck
  /** Frame geometry from ./stage: the 1920×1080 slide scaled to fit its box. */
  stage: typeof stage
  request?: (url: string, init?: RequestInit) => Promise<Response>
}

/**
 * The presentation page of a deck: the audience view shows the slide full screen; the presenter view
 * shows the current slide, the next one, the speaker notes and the elapsed time. Every window of the
 * same design follows the others over a BroadcastChannel, so moving in one moves them all. The slides
 * render in the same isolated frame as the review preview. Every decision lives in the pure deck logic
 * (`update` and `command`); this function only carries its messages. The standalone page serializes
 * this self-contained function.
 */
export function mountPresent(host: HTMLElement, options: PresentOptions) {
  const copy = options.copy
  const logic = options.deck()
  const geometry = options.stage()
  const transport = options.request ?? fetch
  const presenter = options.view === "presenter"
  const SLIDE = { width: 1920, height: 1080 }
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
  // Slide ids need no decoding; anything else in the fragment is ignored by start().
  const self = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const state = {
    host: logic.start(self, location.hash.slice(1), presenter ? Date.now() : 0),
    notes: {} as Record<string, string>,
  }
  const frame = `position:absolute;left:0;top:0;width:${SLIDE.width}px;height:${SLIDE.height}px;border:0;transform-origin:0 0;background:#fff`
  host.innerHTML = presenter
    ? `<style>html,body{margin:0;height:100%;background:#121212;color:#ececec;font:15px/1.5 system-ui,sans-serif;color-scheme:dark}.presenter{box-sizing:border-box;height:100%;padding:16px;display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);grid-template-rows:auto minmax(0,1fr);gap:16px}header{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.spacer{flex:1}.counter{font-weight:600;font-size:18px;font-variant-numeric:tabular-nums}.timer{font:600 28px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums}button{font:inherit;color:inherit;background:#232323;border:1px solid #474747;border-radius:6px;padding:6px 12px;min-height:32px;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px}.frame{position:relative;overflow:hidden;background:#000;border-radius:6px;min-height:0}.frame iframe{${frame}}#upcoming{pointer-events:none}.side{display:grid;grid-template-rows:auto minmax(120px,32%) auto minmax(0,1fr);gap:8px;min-height:0}h2{margin:0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#a8a8a8}.notes{margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:20px;line-height:1.5}.notes[data-empty]{color:#8a8a8a;font-size:15px}.end{position:absolute;inset:0;display:grid;place-items:center;margin:0;color:#8a8a8a}.status{grid-column:1/-1;margin:0}.sync{color:#ffd479;font-weight:600}@media(max-width:760px){.presenter{grid-template-columns:1fr;grid-template-rows:auto minmax(200px,1fr) auto}}</style><div class="presenter"><header><span class="counter" id="counter" aria-live="polite">–</span><span class="timer" id="timer" role="timer" aria-label="${escape(copy.presentElapsed)}">0:00</span><button type="button" id="reset">${escape(copy.presentReset)}</button><span class="sync" id="sync" role="status" hidden>${escape(copy.presentSyncPaused)}</span><span class="spacer"></span><button type="button" id="previous">${escape(copy.presentPrevious)}</button><button type="button" id="next">${escape(copy.presentNext)}</button><button type="button" id="other">${escape(copy.audienceView)}</button></header><p class="status" id="status" role="alert" hidden></p><div class="frame" id="current-frame"><iframe id="slide" title="${escape(copy.presentTitle)}" sandbox="allow-scripts" allow=""></iframe></div><div class="side"><h2>${escape(copy.presentUpNext)}</h2><div class="frame" id="upcoming-frame"><iframe id="upcoming" title="${escape(copy.presentUpNext)}" sandbox="allow-scripts" allow="" tabindex="-1" aria-hidden="true"></iframe><p class="end" id="end" hidden>${escape(copy.presentEnd)}</p></div><h2>${escape(copy.presentNotes)}</h2><p class="notes" id="notes"></p></div></div>`
    : `<style>html,body{margin:0;height:100%;overflow:hidden;background:#000;color:#fff;font:14px/1.4 system-ui,sans-serif;color-scheme:dark}.frame{position:fixed;inset:0;overflow:hidden}.frame iframe{${frame}}.hint,.sync{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);margin:0;padding:6px 14px;border-radius:999px;background:#000b;white-space:nowrap;pointer-events:none;transition:opacity .6s}.sync{top:16px;bottom:auto;background:#000d;color:#ffd479}.hint[data-hidden]{opacity:0}.status{position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:24px;text-align:center}@media(prefers-reduced-motion:reduce){.hint{transition:none}}</style><div class="frame" id="current-frame"><iframe id="slide" title="${escape(copy.presentTitle)}" sandbox="allow-scripts" allow=""></iframe></div><p class="hint" id="hint">${escape(copy.presentHint)}</p><p class="sync" id="sync" role="status" hidden>${escape(copy.presentSyncPaused)}</p><p class="status" id="status" role="alert" hidden></p>`
  const element = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!
  const slide = element<HTMLIFrameElement>("slide")
  const upcoming = presenter ? element<HTMLIFrameElement>("upcoming") : undefined
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(`redcode-design-present:${options.designID}`)
      : undefined

  /** Scales each 1920×1080 frame to fill its box, up or down, centered. */
  const fit = () => {
    const frames = upcoming ? [slide, upcoming] : [slide]
    for (const target of frames) {
      const box = target.parentElement!
      const at = geometry.fit(SLIDE, { width: box.clientWidth, height: box.clientHeight }, 0, true)
      target.style.transform = `translate(${at.x}px,${at.y}px) scale(${at.scale})`
    }
  }
  const index = () => state.host.slides.findIndex((item) => item.id === state.host.show.slide)
  /** Shows the show's slide in the frames, the counter, the notes, the sync notice and the URL. */
  const draw = () => {
    const sent = logic.command(state.host)
    state.host = sent.host
    if (sent.message) slide.contentWindow?.postMessage(sent.message, "*")
    const show = state.host.show
    const slides = state.host.slides
    const at = index()
    if (show.slide && location.hash !== `#${show.slide}`) history.replaceState(null, "", `#${show.slide}`)
    element("sync").hidden = !state.host.paused
    if (!presenter) return
    const next = at >= 0 ? slides[at + 1] : undefined
    element("counter").textContent = at >= 0 ? `${at + 1} / ${slides.length}` : "–"
    element<HTMLButtonElement>("previous").disabled = logic.button("previous", at, slides.length) === undefined
    element<HTMLButtonElement>("next").disabled = logic.button("next", at, slides.length) === undefined
    element("end").hidden = !!next || at < 0
    upcoming!.style.visibility = next ? "visible" : "hidden"
    if (next) upcoming!.contentWindow?.postMessage({ type: "design:screen", id: next.id, scroll: false }, "*")
    const notes = state.notes[show.slide] ?? ""
    element("notes").textContent = notes || copy.presentNoNotes
    if (notes) delete element("notes").dataset.empty
    else element("notes").dataset.empty = ""
  }
  /** Applies one event to this window: tells the other windows what it decided and redraws. */
  const dispatch = (event: PresentEvent) => {
    const was = state.host.paused
    const result = logic.update(state.host, event)
    state.host = result.host
    if (result.post) channel?.postMessage(result.post)
    // Paused, keys pressed inside the slide frame stay there, so focus comes back to this window.
    if (!was && state.host.paused && document.activeElement === slide) slide.blur()
    if (result.draw) draw()
  }
  /** Moves this window and every other window of the show to a slide. */
  const go = (id: string) => dispatch({ type: "move", slide: id })
  const tick = () => {
    const started = state.host.show.started
    if (presenter) element("timer").textContent = logic.clock(started ? Date.now() - started : 0)
  }
  const status = (text: string) => {
    element("status").textContent = text
    element("status").hidden = false
  }
  const view = (name: PresentOptions["view"]) => {
    const url = new URL(location.href)
    url.searchParams.set("view", name)
    url.hash = state.host.show.slide
    return url.toString()
  }
  const other = () =>
    open(
      view(presenter ? "audience" : "presenter"),
      `redcode-${presenter ? "audience" : "presenter"}-${options.designID}`,
      presenter ? "" : "popup,width=1280,height=800",
    )
  const fullscreen = () =>
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(
      () => undefined,
    )

  if (channel)
    channel.onmessage = (event) => {
      dispatch({ type: "channel", message: event.data, now: Date.now() })
      tick()
    }
  window.addEventListener("message", (event) => {
    const data = event.data
    // The next-slide frame only needs to be kept on the next slide once it can take it.
    if (upcoming && event.source === upcoming.contentWindow) {
      if (data?.type === "design:screens") draw()
      return
    }
    if (event.source !== slide.contentWindow) return
    if (data?.type === "design:slides" && Array.isArray(data.slides)) {
      state.notes = Object.fromEntries(
        data.slides.flatMap((item: unknown) =>
          item &&
          typeof item === "object" &&
          "id" in item &&
          typeof item.id === "string" &&
          "notes" in item &&
          typeof item.notes === "string"
            ? [[item.id, item.notes.slice(0, 8000)]]
            : [],
        ),
      )
      draw()
      return
    }
    if (data?.type !== "design:screens" || !Array.isArray(data.screens)) return
    const listed = data.screens.filter(
      (item: unknown): item is { id: string; name: string; variant: string } =>
        !!item &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string" &&
        ID.test(item.id) &&
        "name" in item &&
        typeof item.name === "string" &&
        "variant" in item &&
        typeof item.variant === "string",
    )
    // The slides of the variant the frame shows first, else the ones outside variants.
    const scope = listed[0]?.variant ?? ""
    dispatch({
      type: "frame",
      slides: listed
        .filter((item: { variant: string }) => item.variant === scope)
        .map((item: { id: string; name: string }) => ({ id: item.id, name: item.name.slice(0, 100) })),
      current: data.current && typeof data.current === "object" ? data.current[scope] : undefined,
      origin: data.origin,
      seq: data.seq,
      now: Date.now(),
    })
  })
  // Any key or click here is the reader at work: it resets the loop guard and resumes a paused sync.
  window.addEventListener("pointerdown", () => dispatch({ type: "input" }), true)
  window.addEventListener("keydown", (event) => {
    dispatch({ type: "input" })
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    if (target instanceof HTMLElement && target.matches("input, textarea, select")) return
    if (event.key === " " && target instanceof HTMLButtonElement) return
    if (event.key.toLowerCase() === "f") {
      event.preventDefault()
      void fullscreen()
      return
    }
    if (event.key.toLowerCase() === "p" && !presenter) {
      event.preventDefault()
      other()
      return
    }
    const next = logic.step({ key: event.key, shift: event.shiftKey }, index(), state.host.slides.length)
    if (next === undefined) return
    event.preventDefault()
    go(state.host.slides[next].id)
  })
  if (presenter) {
    for (const which of ["previous", "next"] as const)
      element(which).onclick = () => {
        const next = logic.button(which, index(), state.host.slides.length)
        if (next !== undefined) go(state.host.slides[next].id)
      }
    element("reset").onclick = () => {
      const started = Date.now()
      state.host = { ...state.host, show: { ...state.host.show, started } }
      channel?.postMessage({ type: "reset", started, sender: self })
      tick()
    }
    element("other").onclick = other
  }
  if (!presenter) setTimeout(() => (element("hint").dataset.hidden = ""), 4000)
  new ResizeObserver(fit).observe(element("current-frame"))
  if (presenter) new ResizeObserver(fit).observe(element("upcoming-frame"))
  setInterval(tick, 1000)
  tick()
  fit()
  // Another window of the show answers with where it is; a first window keeps its own place.
  channel?.postMessage({ type: "hello", sender: self })

  const load = async () => {
    const response = await transport(`${options.endpoint}/${encodeURIComponent(options.designID)}`)
    if (!response.ok) return status(`${copy.failure} (${response.status})`)
    const design: { name?: string; revision?: string | null } = await response.json()
    const revision = options.revision || design.revision
    if (!revision) return status(copy.presentEmpty)
    document.title = `${design.name ?? copy.presentTitle} · ${presenter ? copy.presenterView : copy.presentTitle}`
    const preview = await transport(
      `${options.endpoint}/${encodeURIComponent(options.designID)}/revision/${encodeURIComponent(revision)}/preview`,
    )
    if (!preview.ok) return status(`${copy.failure} (${preview.status})`)
    const html = await preview.text()
    slide.srcdoc = html
    if (upcoming) upcoming.srcdoc = html
  }
  void load().catch(() => status(copy.failure))
}

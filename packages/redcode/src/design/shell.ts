/**
 * The page the person actually opens.
 *
 * The shell is ours: it is not model output, it holds the token, and it is the only document that
 * talks to the server. The prototype lives inside its iframe at an opaque origin and can reach the
 * shell only by `postMessage`. Everything the prototype says is treated as a proposal that a person
 * reviews and sends — never as a command.
 *
 * It keeps the review's conversation, the queue of notes, and what the frame reported about itself,
 * all in `sessionStorage` per prototype, so a reload of this page loses nothing a person wrote. It
 * listens to the server's event stream for reloads, the agent's replies, its presence, and the end
 * of the review; and below 860px it folds the panel into a sheet the person raises over the page.
 *
 * Written as a string rather than a built asset so it ships with the binary and cannot drift from
 * the route that serves it.
 */

export interface ShellInput {
  readonly id: string
  readonly name: string
  readonly token: string
  readonly revision: number
  /** Where the prototype lives, for the menu; a person may want to open it in an editor. */
  readonly root?: string
  /** The review already ended, and by whom; the page opens read-only. */
  readonly ended?: "user" | "agent"
  /** Inside the app's own panel the header is the tab; only the frame and the composer remain. */
  readonly embed?: boolean
}

/** Everything the prototype may say; anything else is ignored rather than interpreted. */
export const ARTIFACT_MESSAGES = [
  "ready",
  "queuePrompt",
  "sendQueuedPrompts",
  "endSession",
  "toggleAnnotationMode",
  "snapshot",
  "scroll",
  "status",
  "reviewState",
  "reviewDraftUnrestorable",
  "mode",
] as const

/** Below this width the panel is a sheet over the page, raised from a dock. */
export const MOBILE_SHEET_MEDIA = "(max-width: 860px)"
/** How far a drag on the dock must travel before it is a gesture rather than a tap. */
export const SHEET_DRAG_THRESHOLD_PX = 48
/** A send still unacknowledged after this long says so. */
export const SEND_ACKNOWLEDGEMENT_WARNING_MS = 10_000

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function shellCSP() {
  // Ours, so it is strict: no inline script beyond the one we ship (hashed at serve time would be
  // stricter still, but the shell is served from this origin and never contains model output).
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: https: http:",
    "connect-src 'self'",
    "frame-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")
}

export function shellHTML(input: ShellInput) {
  // Inside a <script>, a "</script>" in the name would end the block early; the JSON escapes every
  // "<" so content can never break out of the string it is in.
  const config = JSON.stringify({
    id: input.id,
    name: input.name,
    token: input.token,
    revision: input.revision,
    root: input.root ?? "",
    ended: input.ended ?? "",
  }).replace(/</g, "\\u003c")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="referrer" content="no-referrer">
<title>${escape(input.name)} · redcode design</title>
<style>
  :root { color-scheme: light dark; --edge: color-mix(in oklab, currentColor 14%, transparent);
          --soft: color-mix(in oklab, currentColor 6%, transparent); --accent: #f4c95d; --accent-ink: #17130a;
          --bar-h: 40px; --dock-h: 60px; --vv-height: 100dvh; --vv-top: 0px }
  * { box-sizing: border-box }
  html, body { height: 100% }
  body { margin: 0; display: grid; grid-template-rows: var(--bar-h) 1fr; height: 100dvh;
         font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; overflow: hidden }
  header { display: flex; gap: .6rem; align-items: center; padding: 0 .75rem; border-bottom: 1px solid var(--edge) }
  header strong { font-weight: 600; white-space: nowrap }
  header .status { opacity: .6; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  main { display: grid; grid-template-columns: minmax(0, 1fr) min(360px, 34vw); min-height: 0; position: relative }
  iframe { border: 0; width: 100%; height: 100%; background: #fff }
  button { font: inherit; padding: .4rem .75rem; border-radius: .375rem; border: 1px solid var(--edge);
           background: transparent; color: inherit; cursor: pointer }
  button[disabled] { opacity: .5; cursor: default }
  button.mode { padding: .25rem .6rem }
  button.mode[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent) }
  button.more { padding: .25rem .5rem; font-weight: 700 }
  .menu { position: absolute; right: .5rem; top: calc(var(--bar-h) + .25rem); z-index: 40; min-width: 240px;
          background: Canvas; color: CanvasText; border: 1px solid var(--edge); border-radius: .5rem;
          box-shadow: 0 12px 40px rgba(0,0,0,.25); padding: .25rem; display: none }
  .menu[data-open] { display: block }
  .menu button { display: block; width: 100%; text-align: left; border: 0; border-radius: .375rem; padding: .45rem .6rem }
  .menu button:hover { background: var(--soft) }
  .menu button.danger { color: #d0432b }
  .menu .path { padding: .35rem .6rem; font-size: 11px; opacity: .7; word-break: break-all; border-bottom: 1px solid var(--edge); margin-bottom: .25rem }
  .panel { display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; border-left: 1px solid var(--edge); min-height: 0; background: Canvas }
  .panel-head { display: none }
  .scroll { overflow: auto; padding: .5rem .75rem; display: flex; flex-direction: column; gap: .5rem }
  .bubble { max-width: 92%; padding: .45rem .6rem; border-radius: .6rem; background: var(--soft); white-space: pre-wrap; word-break: break-word }
  .bubble small { display: block; font-size: 10px; opacity: .6; text-transform: uppercase; letter-spacing: .06em; margin-bottom: .15rem }
  .bubble.user { align-self: flex-end; background: color-mix(in oklab, var(--accent) 22%, transparent) }
  .bubble.agent { align-self: flex-start }
  .bubble.note { align-self: stretch; max-width: none; border: 1px dashed var(--edge); background: transparent }
  .bubble.note .draft { margin-top: .35rem; padding: .35rem .5rem; border-radius: .375rem; background: var(--soft); user-select: all }
  .bubble.note .warn { margin-top: .35rem; color: #d0432b }
  .bubble.working { opacity: .7; font-style: italic }
  .pills { display: flex; flex-wrap: wrap; gap: .35rem; padding: .25rem .75rem; border-top: 1px solid var(--edge) }
  .pills:empty { display: none }
  .pill { position: relative; display: inline-flex; align-items: center; gap: .3rem; max-width: 100%;
          padding: .2rem .5rem; border-radius: 999px; background: color-mix(in oklab, var(--accent) 22%, transparent); font-size: 12px }
  .pill span { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  .pill button { border: 0; padding: 0 .2rem; line-height: 1; opacity: .7 }
  .pill .tip { display: none; position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 30; min-width: 220px; max-width: 320px;
               padding: .5rem .6rem; border-radius: .5rem; background: Canvas; color: CanvasText; border: 1px solid var(--edge);
               box-shadow: 0 8px 30px rgba(0,0,0,.25); white-space: pre-wrap; font-size: 12px }
  .pill:hover .tip, .pill:focus-within .tip { display: block }
  .tip b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin-top: .3rem }
  .tip b:first-child { margin-top: 0 }
  form { display: grid; gap: .5rem; padding: .6rem .75rem; border-top: 1px solid var(--edge) }
  .banner { font-size: 12px; padding: .35rem .5rem; border-radius: .375rem; background: var(--soft) }
  .banner[hidden] { display: none }
  textarea { font: inherit; min-height: 3.6rem; resize: vertical; padding: .5rem;
             border: 1px solid var(--edge); border-radius: .375rem; background: transparent; color: inherit }
  .hint { font-size: 11px; opacity: .7; min-height: 1.2em }
  .hint.alert { opacity: 1; color: #d0432b }
  .actions { display: flex; gap: .5rem; align-items: center; justify-content: flex-end }
  .actions .send { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600 }
  .draft-img { display: none; align-items: center; gap: .5rem; font-size: 12px; opacity: .8 }
  .draft-img img { max-height: 40px; border-radius: .25rem; border: 1px solid var(--edge) }
  .draft-img[data-on] { display: flex }
  .overlay { position: absolute; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center;
             background: color-mix(in oklab, Canvas 85%, transparent); text-align: center; padding: 2rem }
  .overlay[data-on] { display: flex }
  .overlay .card { max-width: 380px; padding: 1.25rem; border-radius: .75rem; background: Canvas; border: 1px solid var(--edge); box-shadow: 0 20px 70px rgba(0,0,0,.3) }
  .overlay h2 { margin: 0 0 .5rem; font-size: 15px }
  .scrim { display: none }
  body[data-embed] header strong { display: none }
  body[data-ended] textarea, body[data-ended] .actions button { pointer-events: none; opacity: .5 }
  @media ${MOBILE_SHEET_MEDIA} {
    :root { --sheet-top: max(var(--bar-h) + 16px - var(--vv-top), 16px) }
    main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) calc(var(--dock-h) + env(safe-area-inset-bottom, 0px)) }
    .panel { position: fixed; z-index: 30; left: 0; right: 0; top: calc(var(--vv-top) + var(--sheet-top));
             height: calc(var(--vv-height) - var(--sheet-top)); border-left: 0; border-radius: 14px 14px 0 0;
             box-shadow: 0 -1px 0 var(--edge), 0 -20px 70px rgba(0,0,0,.25);
             transform: translateY(calc(100% - var(--dock-h) - env(safe-area-inset-bottom, 0px)));
             transition: transform .28s ease; will-change: transform }
    body[data-sheet] .panel { transform: none }
    .panel.dragging { transition: none }
    .panel-head { display: flex; flex-direction: column; height: var(--dock-h); padding: 6px 16px 0; cursor: pointer;
                  user-select: none; -webkit-user-select: none; touch-action: none }
    body:not([data-sheet]) .panel-head { height: calc(var(--dock-h) + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px) }
    .handle { width: 36px; height: 4px; margin: 0 auto 6px; border-radius: 999px; background: var(--edge) }
    .head-row { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 }
    .head-row h2 { margin: 0; font-size: 13px; flex: 0 0 auto }
    .summary { flex: 1; min-width: 0; text-align: right; font-size: 12px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
    .summary.accent { color: var(--accent); opacity: 1; font-weight: 600 }
    .summary.unread::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 999px; background: var(--accent) }
    .toggle { width: 32px; height: 32px; padding: 0; border-radius: 999px; display: flex; align-items: center; justify-content: center }
    .toggle svg { transition: transform .2s ease }
    body[data-sheet] .toggle svg { transform: rotate(180deg) }
    .panel-head.fresh .toggle { animation: pulse .7s ease }
    @keyframes pulse { 0% { transform: scale(1) } 40% { transform: scale(1.18) } 100% { transform: scale(1) } }
    .scrim { display: block; position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.35); opacity: 0; pointer-events: none; transition: opacity .28s ease }
    body[data-sheet] .scrim { opacity: 1; pointer-events: auto }
    form { padding-bottom: calc(.6rem + env(safe-area-inset-bottom, 0px)) }
  }
  @media ${MOBILE_SHEET_MEDIA} and (prefers-reduced-motion: reduce) { .panel, .scrim { transition: none } }
</style>
</head>
<body${input.embed ? " data-embed" : ""}${input.ended ? " data-ended" : ""}>
<header>
  <strong>${escape(input.name)}</strong>
  <span class="status" id="status">click an element in the prototype to annotate it</span>
  <button class="mode" id="mode" type="button" aria-pressed="true" title="Toggle annotate/explore mode (⌘I / Ctrl+I)">Annotate</button>
  <button class="more" id="more" type="button" aria-label="More" aria-haspopup="menu">⋮</button>
</header>
<div class="menu" id="menu" role="menu">
  <div class="path" id="path"></div>
  <button type="button" id="copyPath">Copy directory path</button>
  <button type="button" id="reload">Reload prototype</button>
  <button type="button" id="copySnapshot">Copy DOM snapshot</button>
  <button type="button" id="endSession" class="danger">End review</button>
</div>
<main>
  <!-- The sandbox list below deliberately withholds same-origin access: the document inside is
       model-written and must stay at an opaque origin, unable to read this page's token. The
       serving route repeats the restriction in a header, so it holds even when this page is
       bypassed and the prototype URL is opened directly. -->
  <iframe id="frame" sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe>
  <div class="scrim" id="scrim"></div>
  <aside class="panel" id="panel">
    <div class="panel-head" id="panelHead">
      <div class="handle"></div>
      <div class="head-row">
        <h2>Conversation</h2>
        <span class="summary" id="summary"></span>
        <button class="toggle" id="toggle" type="button" aria-expanded="false" aria-label="Show conversation">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 9l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="scroll" id="scroll"></div>
    <div class="pills" id="pills"></div>
    <form id="composer">
      <div class="banner" id="presence" hidden>The agent is idle. What you send starts its next turn.</div>
      <textarea id="text" placeholder="Write a message… paste or drop an image to show something"></textarea>
      <div class="draft-img" id="draft"><img id="draftImg" alt=""><span>image attached</span><button type="button" id="dropImg">remove</button></div>
      <div class="hint" id="hint"></div>
      <div class="actions">
        <button id="hold" type="button" title="Keep this note in the queue and carry on; nothing is sent until you press Send">Hold</button>
        <button id="sendEnd" type="button" title="Send what is queued and end the review">Send &amp; End</button>
        <button id="send" type="submit" class="send">Send to Agent</button>
      </div>
    </form>
  </aside>
  <div class="overlay" id="ended"><div class="card"><h2 id="endedTitle">Review ended</h2><p id="endedCopy"></p></div></div>
</main>
<script>
(() => {
  const config = ${config}
  const $ = (id) => document.getElementById(id)
  const frame = $("frame"), status = $("status"), text = $("text"), send = $("send"), sendEnd = $("sendEnd"), hold = $("hold")
  const modeButton = $("mode"), more = $("more"), menu = $("menu"), pills = $("pills"), scroll = $("scroll")
  const hint = $("hint"), presence = $("presence"), draft = $("draft"), draftImg = $("draftImg")
  const panel = $("panel"), panelHead = $("panelHead"), summary = $("summary"), toggle = $("toggle"), scrim = $("scrim")
  const endedOverlay = $("ended"), endedCopy = $("endedCopy")
  const base = location.pathname.replace(/\\/$/, "")
  const key = (name) => "redcode-design:" + name + ":" + config.id
  const load = (name, fallback) => { try { const raw = sessionStorage.getItem(key(name)); return raw === null ? fallback : JSON.parse(raw) } catch { return fallback } }
  const save = (name, value) => { try { if (value === null || value === undefined) sessionStorage.removeItem(key(name)); else sessionStorage.setItem(key(name), JSON.stringify(value)); return true } catch { return false } }

  let revision = config.revision
  let annotate = true
  let ended = config.ended || ""
  let presenceState = "waiting"
  let pending = (load("queued", []) || []).filter((x) => x && typeof x === "object" && typeof x.text === "string")
  let chat = []
  let retired = (load("retired", []) || []).filter((x) => typeof x === "string" && x.trim())
  let reviewState = load("review", null)
  let scrollPos = load("scroll", null)
  let unrestorableMiss = null
  let snapshotWaiter = null
  let sending = null
  let sendAgain = false
  let ackTimer = 0
  let unread = ""
  let image = null

  const tell = (type, payload) => { try { frame.contentWindow.postMessage({ source: "redcode-design-shell", type, payload: payload || {} }, "*") } catch {} }
  const loadFrame = () => { frame.src = base + "/files/index.html?rev=" + revision }
  const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

  // --- what a note points at ------------------------------------------------------------------
  const where = (item) => {
    const t = item.target
    if (t && t.type === "text-range") return "text: “" + String(t.text || "").slice(0, 80) + "”"
    if (t && t.type === "table-cell") {
      const cell = [t.rowLabel, t.columnLabel].filter(Boolean).join(" → ")
      return cell ? "cell: " + cell : "cell " + t.selector
    }
    if (t && t.type === "mermaid-node") return "node: " + (t.label || t.nodeId)
    if (item.tag === "message") return ""
    return item.label || item.selector || ""
  }

  // --- the conversation ------------------------------------------------------------------------
  const bubble = (role, body, label) => {
    const el = document.createElement("div")
    el.className = "bubble " + role
    el.innerHTML = "<small>" + escapeHtml(label || (role === "agent" ? "Agent" : "You")) + "</small><div>" + escapeHtml(body) + "</div>"
    return el
  }
  const retiredNode = (value, stored) => {
    const el = document.createElement("div")
    el.className = "bubble note"
    el.innerHTML = "<small>Unsent annotation</small><div>The element this note was attached to is no longer in the prototype, so the card could not be reopened. Your text is kept here:</div>" +
      '<div class="draft">' + escapeHtml(value) + "</div>" + (stored ? "" : '<div class="warn">This browser refused to store it, so copy it before you reload this page.</div>')
    return el
  }
  const drawChat = () => {
    const nodes = chat.map((c) => bubble(c.role, c.text))
    if (presenceState === "working" && !ended) {
      const working = document.createElement("div")
      working.className = "bubble agent working"
      working.textContent = "Working…"
      nodes.push(working)
    }
    for (const value of retired) nodes.push(retiredNode(value, true))
    scroll.replaceChildren(...nodes)
    scroll.scrollTop = scroll.scrollHeight
  }

  // --- the queue -------------------------------------------------------------------------------
  const persistQueue = () => save("queued", pending.length ? pending : null)
  const drawPills = () => {
    pills.replaceChildren(...pending.map((item, index) => {
      const pill = document.createElement("div")
      pill.className = "pill"
      pill.tabIndex = 0
      const at = where(item)
      const label = document.createElement("span")
      label.textContent = (at ? at + " · " : "") + item.text
      const remove = document.createElement("button")
      remove.type = "button"
      remove.setAttribute("aria-label", "Remove queued note")
      remove.textContent = "×"
      remove.addEventListener("click", (event) => { event.stopPropagation(); pending.splice(index, 1); persistQueue(); draw() })
      const tip = document.createElement("div")
      tip.className = "tip"
      tip.innerHTML = (at ? "<b>Target</b>" + escapeHtml(at) : "") +
        (item.selector && item.selector !== at ? "<b>Locator</b>" + escapeHtml(item.selector) : "") +
        "<b>Note</b>" + escapeHtml(item.text)
      pill.append(label, remove, tip)
      return pill
    }))
  }
  const draw = () => {
    drawPills()
    const typed = text.value.trim() !== "" || image !== null
    send.disabled = !!ended || (pending.length === 0 && !typed)
    sendEnd.disabled = !!ended
    hold.disabled = !!ended || !typed
    const count = pending.length + (typed ? 1 : 0)
    send.textContent = count > 1 ? "Send " + count + " notes" : "Send to Agent"
    draft.toggleAttribute("data-on", image !== null)
    if (image) draftImg.src = "data:" + image.mime + ";base64," + image.data
    drawSummary()
  }
  const enqueue = (p) => {
    if (!p || typeof p !== "object" || ended) return
    const words = String(p.prompt || "").slice(0, 4000)
    if (!words.trim()) return
    const item = {
      selector: String(p.selector || "").slice(0, 512),
      tag: String(p.tag || "").slice(0, 40),
      elementText: String(p.text || "").slice(0, 240),
      text: words,
      ...(p.target && typeof p.target === "object" ? { target: p.target } : {}),
      ...(p.queueKey ? { queueKey: String(p.queueKey).slice(0, 200) } : {}),
    }
    const at = item.queueKey ? pending.findIndex((x) => x.queueKey === item.queueKey) : -1
    pending = at >= 0 ? pending.map((x, i) => (i === at ? item : x)) : pending.concat([item]).slice(0, 50)
    persistQueue()
    draw()
    pulse()
    status.textContent = pending.length + " queued · press Send when you are done"
  }

  // --- images beside the composer (downscaled here; the server checks the bytes again) -----------
  const MAX_EDGE = 1280
  const MAX_B64 = 800000
  const attach = (file) => {
    if (!file || !/^image\\/(png|jpeg|webp)$/.test(file.type)) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)
      let mime = "image/png"
      let data = canvas.toDataURL(mime)
      if (data.length > MAX_B64) { mime = "image/jpeg"; data = canvas.toDataURL(mime, 0.85) }
      if (data.length > MAX_B64) { data = canvas.toDataURL(mime, 0.6) }
      if (data.length > MAX_B64) { note("that image is too large even downscaled", true); return }
      image = { mime, data: data.slice(data.indexOf(",") + 1) }
      draw()
    }
    img.onerror = () => { URL.revokeObjectURL(url); note("could not read that image", true) }
    img.src = url
  }
  text.addEventListener("paste", (event) => {
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))
    if (!item) return
    event.preventDefault()
    attach(item.getAsFile())
  })
  text.addEventListener("dragover", (event) => event.preventDefault())
  text.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    event.preventDefault()
    attach(file)
  })
  $("dropImg").addEventListener("click", () => { image = null; draw() })

  // --- hints and the mode ----------------------------------------------------------------------
  let hintTimer = 0
  const note = (message, alert) => {
    clearTimeout(hintTimer)
    hint.textContent = message || ""
    hint.classList.toggle("alert", !!alert)
    if (message && !alert) hintTimer = setTimeout(() => { hint.textContent = "" }, 2600)
  }
  const setMode = (next) => {
    annotate = !!next && !ended
    modeButton.setAttribute("aria-pressed", String(annotate))
    modeButton.textContent = annotate ? "Annotate" : "Explore"
    tell("setAnnotationMode", { annotate })
  }
  modeButton.addEventListener("click", () => setMode(!annotate))
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeMenu(); if (sheetOpen) setSheet(false); return }
    if (event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) return
    if (String(event.key || "").toLowerCase() !== "i") return
    event.preventDefault()
    setMode(!annotate)
  }, true)

  // --- the menu --------------------------------------------------------------------------------
  const closeMenu = () => menu.removeAttribute("data-open")
  more.addEventListener("click", (event) => { event.stopPropagation(); menu.toggleAttribute("data-open") })
  document.addEventListener("click", (event) => { if (!menu.contains(event.target)) closeMenu() })
  $("path").textContent = config.root || ""
  $("copyPath").addEventListener("click", async () => { closeMenu(); try { await navigator.clipboard.writeText(config.root || location.href); note("copied") } catch { note("could not copy", true) } })
  $("reload").addEventListener("click", () => { closeMenu(); loadFrame(); status.textContent = "reloaded" })
  $("copySnapshot").addEventListener("click", async () => { closeMenu(); const dom = await snapshot(); try { await navigator.clipboard.writeText(dom); note("snapshot copied") } catch { note("could not copy", true) } })
  $("endSession").addEventListener("click", () => { closeMenu(); endReview() })

  // --- the review ends -------------------------------------------------------------------------
  const markEnded = (by) => {
    ended = by || "user"
    document.body.setAttribute("data-ended", ended)
    endedCopy.textContent = ended === "agent" ? "The agent finished this review. Nothing more is sent from here." : "You ended this review. Nothing more is sent from here."
    endedOverlay.setAttribute("data-on", "")
    closeMenu()
    setMode(false)
    presence.hidden = true
    draw()
    drawChat()
    applySheet()
  }
  const endReview = async () => {
    if (ended) return
    if (pending.length || text.value.trim() || image) { await submit(undefined, true); return }
    try {
      const response = await fetch(base + "/end", { method: "POST", headers: { "x-redcode-design-token": config.token } })
      if (!response.ok) throw new Error("HTTP " + response.status)
      markEnded("user")
    } catch (error) { note("could not end the review (" + error.message + ")", true) }
  }

  // --- what the frame says ---------------------------------------------------------------------
  const ALLOWED = new Set(${JSON.stringify(ARTIFACT_MESSAGES)})
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return
    const data = event.data
    if (!data || typeof data !== "object") return
    if (data.source !== "redcode-design" || data.v !== 2) return
    if (!ALLOWED.has(data.type)) return
    if (data.load !== revision) return
    const payload = data.payload || {}
    switch (data.type) {
      case "ready": {
        status.textContent = ended ? "review ended" : annotate ? "click an element in the prototype to annotate it" : "explore mode · ⌘I / Ctrl+I to annotate"
        if (payload.title) document.title = String(payload.title).slice(0, 200) + " · " + config.name
        if (payload.icon) {
          let link = document.querySelector('link[rel="icon"]')
          if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.append(link) }
          link.href = String(payload.icon)
        }
        tell("setAnnotationMode", { annotate })
        if (scrollPos) tell("restoreScroll", scrollPos)
        if (reviewState) tell("restoreReviewState", { state: reviewState })
        return
      }
      case "queuePrompt": enqueue(payload.prompt); return
      case "sendQueuedPrompts": submit(); return
      case "endSession": endReview(); return
      case "toggleAnnotationMode": setMode(!annotate); return
      case "mode": return
      case "snapshot": if (snapshotWaiter) snapshotWaiter(String(payload.snapshot || "")); return
      case "scroll": scrollPos = { x: Number(payload.x) || 0, y: Number(payload.y) || 0 }; save("scroll", scrollPos); return
      case "status": status.textContent = String(payload.message || "").slice(0, 200); return
      case "reviewState": setReviewState(payload.state); return
      case "reviewDraftUnrestorable": discardUnrestorable(String(payload.selector || "")); return
    }
  })

  // The frame reported the state it owns: an open card's text and the controls in a question.
  // Persisted, because it is the person's own writing and this page's memory dies with it.
  const setReviewState = (state) => {
    if (!state || typeof state !== "object") return
    if (state.card) unrestorableMiss = null
    reviewState = state.card || (Array.isArray(state.fields) && state.fields.length) ? state : null
    save("review", reviewState)
  }
  // Retiring a draft is data loss too, so one miss only records the answer: only a second
  // revision reporting the same anchor missing retires it, and then the text is handed back.
  const discardUnrestorable = (selector) => {
    if (!selector || !reviewState || !reviewState.card) return
    if (String(reviewState.card.selector || "") !== selector) return
    if (!unrestorableMiss || unrestorableMiss.selector !== selector) { unrestorableMiss = { selector, revision }; return }
    if (unrestorableMiss.revision === revision) return
    unrestorableMiss = null
    const value = String(reviewState.card.text || "")
    if (value.trim()) {
      retired = retired.concat([value])
      const stored = save("retired", retired)
      scroll.append(retiredNode(value, stored))
      scroll.scrollTop = scroll.scrollHeight
    }
    setReviewState({ ...reviewState, card: null })
  }

  // --- sending ---------------------------------------------------------------------------------
  const snapshot = () => new Promise((resolve) => {
    const timer = setTimeout(() => { snapshotWaiter = null; resolve("") }, 600)
    snapshotWaiter = (value) => { clearTimeout(timer); snapshotWaiter = null; resolve(value) }
    tell("requestSnapshot", { reason: "submit" })
  })
  const armAck = () => { clearTimeout(ackTimer); ackTimer = setTimeout(() => note("Still trying to send… your notes are kept in this tab.", true), ${SEND_ACKNOWLEDGEMENT_WARNING_MS}) }
  const submit = async (event, end) => {
    if (event) event.preventDefault()
    if (ended) return
    // What was typed joins the queue first, so a failure past this point loses nothing.
    const typed = text.value.trim()
    if (typed || image) {
      pending = pending.concat([{ tag: "message", text: typed || "See the attached image.", ...(image ? { image } : {}) }]).slice(0, 50)
      persistQueue()
      text.value = ""
      image = null
      draw()
    }
    if (!pending.length) { if (end) await endReview(); else note("Write a message or annotate an element first."); return }
    if (sending) { sendAgain = true; return sending }
    sending = (async () => {
      send.disabled = true
      status.textContent = "sending…"
      armAck()
      const items = pending.slice()
      try {
        const dom = await snapshot()
        const response = await fetch(base + "/feedback", {
          method: "POST",
          headers: { "content-type": "application/json", "x-redcode-design-token": config.token },
          body: JSON.stringify({ items, viewport: { width: innerWidth, height: innerHeight }, ...(dom ? { snapshot: dom } : {}), ...(end ? { end: true } : {}) }),
        })
        if (response.status === 409) { markEnded("user"); return }
        if (!response.ok) throw new Error("HTTP " + response.status)
        pending = pending.filter((x) => !items.includes(x))
        persistQueue()
        clearTimeout(ackTimer)
        note("")
        for (const item of items) if (item.tag === "message") chat.push({ role: "user", text: item.text, at: Date.now() })
        const notes = items.filter((x) => x.tag !== "message").length
        if (notes) chat.push({ role: "user", text: notes + " annotation" + (notes === 1 ? "" : "s") + " sent", at: Date.now() })
        drawChat()
        draw()
        status.textContent = end ? "sent · review ended" : "sent · the agent has it"
        if (end) markEnded("user")
      } catch (error) {
        clearTimeout(ackTimer)
        note("Could not send (" + error.message + "). Your notes are still queued in this tab.", true)
        draw()
      } finally {
        sending = null
        if (sendAgain && pending.length && !ended) { sendAgain = false; submit() } else sendAgain = false
      }
    })()
    return sending
  }
  $("composer").addEventListener("submit", submit)
  sendEnd.addEventListener("click", () => submit(undefined, true))
  // Hold: the note joins the queue and nothing leaves this page. The agent is woken by Send, and
  // by nothing else — a person decides when a batch is a batch.
  hold.addEventListener("click", () => {
    const typed = text.value.trim()
    if (!typed && !image) return
    pending = pending.concat([{ tag: "message", text: typed || "See the attached image.", ...(image ? { image } : {}) }]).slice(0, 50)
    persistQueue()
    text.value = ""
    image = null
    draw()
    status.textContent = pending.length + " held · press Send when you are done"
  })
  text.addEventListener("input", draw)
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit() }
  })

  // --- the sheet, on a phone --------------------------------------------------------------------
  const media = typeof matchMedia === "function" ? matchMedia(${JSON.stringify(MOBILE_SHEET_MEDIA)}) : null
  const mobile = () => !!(media && media.matches)
  let sheetOpen = load("sheet", false) === true
  let drag = null
  let suppressClick = false
  const summarize = () => {
    if (ended) return { text: "Review ended", accent: false, unread: false }
    if (pending.length) return { text: pending.length === 1 ? "1 queued" : pending.length + " queued", accent: true, unread: false }
    if (unread) return { text: unread, accent: false, unread: true }
    return { text: presenceState === "working" ? "Agent is working…" : "Agent idle", accent: false, unread: false }
  }
  const drawSummary = () => {
    const s = summarize()
    summary.textContent = s.text
    summary.classList.toggle("accent", s.accent)
    summary.classList.toggle("unread", s.unread)
  }
  const applySheet = () => {
    const open = mobile() && sheetOpen
    document.body.toggleAttribute("data-sheet", open)
    const docked = mobile() && !open
    scroll.inert = !!ended || docked
    $("composer").inert = !!ended || docked
    if (docked && document.activeElement && panel.contains(document.activeElement)) toggle.focus()
    toggle.setAttribute("aria-expanded", open ? "true" : "false")
    toggle.setAttribute("aria-label", open ? "Hide conversation" : "Show conversation")
    drawSummary()
  }
  const setSheet = (open) => {
    sheetOpen = !!open
    save("sheet", sheetOpen ? true : null)
    if (sheetOpen) unread = ""
    applySheet()
    if (sheetOpen && mobile()) scroll.scrollTop = scroll.scrollHeight
  }
  const pulse = () => {
    if (!mobile() || sheetOpen) return
    panelHead.classList.remove("fresh")
    void panelHead.offsetWidth
    panelHead.classList.add("fresh")
  }
  panelHead.addEventListener("click", () => { if (!mobile()) return; if (suppressClick) { suppressClick = false; return } setSheet(!sheetOpen) })
  scrim.addEventListener("click", () => setSheet(false))
  panelHead.addEventListener("pointerdown", (event) => {
    if (!mobile() || event.button) return
    drag = { id: event.pointerId, y: Number(event.clientY), moved: false }
    if (panelHead.setPointerCapture) panelHead.setPointerCapture(event.pointerId)
  })
  panelHead.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const offset = Number(event.clientY) - drag.y
    if (Math.abs(offset) > 6) drag.moved = true
    if (!drag.moved) return
    panel.classList.add("dragging")
    panel.style.transform = sheetOpen ? "translateY(" + Math.max(0, offset) + "px)" : "translateY(calc(100% - var(--dock-h) - env(safe-area-inset-bottom, 0px) + " + Math.min(0, offset) + "px))"
  })
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const offset = Number(event.clientY) - drag.y
    const moved = drag.moved
    drag = null
    panel.classList.remove("dragging")
    panel.style.transform = ""
    if (!moved) return
    suppressClick = true
    if (sheetOpen && offset > ${SHEET_DRAG_THRESHOLD_PX}) setSheet(false)
    else if (!sheetOpen && offset < -${SHEET_DRAG_THRESHOLD_PX}) setSheet(true)
  }
  panelHead.addEventListener("pointerup", endDrag)
  panelHead.addEventListener("pointercancel", () => { drag = null; panel.classList.remove("dragging"); panel.style.transform = ""; suppressClick = false })
  if (media && media.addEventListener) media.addEventListener("change", (event) => { if (!event.matches) { sheetOpen = false; save("sheet", null) } applySheet() })
  const syncViewport = () => {
    const vv = window.visualViewport
    const height = vv ? vv.height : innerHeight
    if (!(height > 0)) return
    document.documentElement.style.setProperty("--vv-height", Math.round(height) + "px")
    document.documentElement.style.setProperty("--vv-top", Math.round(Math.max(0, vv ? vv.offsetTop : 0)) + "px")
  }
  if (window.visualViewport) { visualViewport.addEventListener("resize", syncViewport); visualViewport.addEventListener("scroll", syncViewport) }
  addEventListener("resize", syncViewport)
  syncViewport()

  // --- the server's live events ----------------------------------------------------------------
  // Reconnects on its own with a backoff; a reconnect replays the conversation, so nothing is missed.
  let backoff = 500
  const connect = () => {
    const source = new EventSource(base + "/events?token=" + encodeURIComponent(config.token))
    const on = (type, handler) => source.addEventListener(type, (event) => { let data = {}; try { data = JSON.parse(event.data) } catch {} handler(data) })
    source.addEventListener("open", () => { backoff = 500 })
    on("reload", (data) => {
      if (typeof data.revision !== "number" || data.revision === revision) return
      revision = data.revision
      loadFrame()
      status.textContent = "the agent revised this · reloaded"
    })
    on("chat-sync", (data) => { if (Array.isArray(data.chat)) { chat = data.chat.filter((c) => c && typeof c.text === "string"); drawChat() } })
    on("agent-reply", (data) => {
      if (!data.text) return
      if (chat.at(-1)?.text !== data.text) chat.push({ role: "agent", text: String(data.text), at: Number(data.at) || Date.now() })
      if (mobile() && !sheetOpen) { unread = String(data.text).slice(0, 80); pulse() }
      drawChat()
      drawSummary()
    })
    on("presence", (data) => {
      presenceState = data.state === "working" ? "working" : "waiting"
      presence.hidden = !!ended || presenceState !== "waiting"
      drawChat()
      drawSummary()
    })
    on("ended", (data) => markEnded(data.by === "agent" ? "agent" : "user"))
    source.addEventListener("error", () => {
      source.close()
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, 5000)
    })
  }

  loadFrame()
  connect()
  drawChat()
  draw()
  applySheet()
  if (ended) markEnded(ended)
})()
</script>
</body>
</html>`
}

export * as DesignShell from "./shell"

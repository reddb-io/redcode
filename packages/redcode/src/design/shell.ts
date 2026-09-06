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
  /** The image limits the server enforces; the page refuses early and says why. */
  readonly attachments?: { readonly maxCount: number; readonly maxBytes: number; readonly accepted: readonly string[] }
  /** Hold the prototype behind a curtain until its first layout pass; off for an ended review. */
  readonly gate?: boolean
  /** How long the curtain may hold before the prototype is shown anyway. */
  readonly gateTimeoutMs?: number
  /** The same review as another device on the network reaches it, when the server listens beyond loopback. */
  readonly networkUrl?: string
  /** The whiteboard bundle is on this machine: diagrams open as whiteboards, and the page hosts them full screen. */
  readonly whiteboard?: boolean
}

/** How long a reload waits for open whiteboards to save before the frame is replaced. */
export const WHITEBOARD_FLUSH_MS = 1500

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
  "uploadAttachment",
  "mode",
  "layoutDiagnostics",
  "artifactAssetFailure",
] as const

/** A page may upload this many images a minute, this many bytes in its lifetime, this many at once. */
export const UPLOAD_RATE_MAX = 30
export const UPLOAD_RATE_WINDOW_MS = 60_000
export const UPLOAD_SESSION_BYTE_QUOTA = 256 * 1024 * 1024
export const UPLOAD_MAX_IN_FLIGHT = 4

/** Below this width the panel is a sheet over the page, raised from a dock. */
export const MOBILE_SHEET_MEDIA = "(max-width: 860px)"
/** How far a drag on the dock must travel before it is a gesture rather than a tap. */
export const SHEET_DRAG_THRESHOLD_PX = 48
/** A send still unacknowledged after this long says so. */
export const SEND_ACKNOWLEDGEMENT_WARNING_MS = 10_000
/** A frame that has said nothing after this long is asked whether it can be served at all. */
export const ARTIFACT_SILENCE_PROBE_MS = 8_000
/** A frame that has still said nothing after this long gets a card with a way out. */
export const ARTIFACT_BOOT_FAILSAFE_MS = 15_000
/** The curtain's default hold, when the server sends none. */
export const GATE_TIMEOUT_MS = 12_000

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function shellCSP() {
  // Ours, so it is strict: no inline script beyond the one we ship (hashed at serve time would be
  // stricter still, but the shell is served from this origin and never contains model output).
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data: https: http:",
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
    attachments: input.attachments ?? {
      maxCount: 4,
      maxBytes: 10 * 1024 * 1024,
      accepted: ["image/png", "image/jpeg", "image/webp"],
    },
    gate: input.gate !== false && !input.ended,
    gateTimeoutMs: input.gateTimeoutMs && input.gateTimeoutMs > 0 ? input.gateTimeoutMs : GATE_TIMEOUT_MS,
    networkUrl: input.networkUrl ?? "",
    whiteboard: input.whiteboard === true,
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
  .stage { position: relative; min-width: 0; min-height: 0 }
  iframe { border: 0; width: 100%; height: 100%; background: #fff; display: block }
  button { font: inherit; padding: .4rem .75rem; border-radius: .375rem; border: 1px solid var(--edge);
           background: transparent; color: inherit; cursor: pointer }
  button[disabled] { opacity: .5; cursor: default }
  button.mode { padding: .25rem .6rem }
  button.mode[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent) }
  button.more { padding: .25rem .5rem; font-weight: 700 }
  button.issues { padding: .25rem .6rem; display: inline-flex; align-items: center; gap: .4rem; border-color: #d0432b; color: #d0432b }
  button.issues[aria-expanded="true"] { background: color-mix(in oklab, #d0432b 14%, transparent) }
  .badge { display: inline-block; min-width: 1.4em; padding: 0 .35em; border-radius: 999px; background: #d0432b; color: #fff; font-size: 11px; font-weight: 700; text-align: center; line-height: 1.5 }
  .drawer { position: absolute; top: .5rem; right: .5rem; z-index: 45; width: min(440px, calc(100% - 1rem)); max-height: calc(100% - 1rem);
            display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: Canvas; color: CanvasText;
            border: 1px solid var(--edge); border-radius: .6rem; box-shadow: 0 12px 40px rgba(0,0,0,.25) }
  .drawer[hidden] { display: none }
  .drawer-head, .drawer-foot { display: flex; align-items: center; gap: .6rem; padding: .5rem .75rem; border-bottom: 1px solid var(--edge) }
  .drawer-foot { border-bottom: 0; border-top: 1px solid var(--edge); justify-content: flex-end }
  .drawer-head label { display: inline-flex; align-items: center; gap: .35rem }
  .drawer-head .sum { flex: 1; min-width: 0; font-size: 12px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  .drawer-head .close { border: 0; padding: .1rem .4rem; font-size: 16px; line-height: 1 }
  .drawer-foot .sel { flex: 1; font-size: 12px; opacity: .7 }
  .warnings { overflow: auto; display: flex; flex-direction: column }
  .warnings .empty { padding: 1rem .75rem; opacity: .7 }
  .warning { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .5rem; padding: .6rem .75rem; border-bottom: 1px solid var(--edge) }
  .warning.outstanding { opacity: .75 }
  .warning input { margin-top: .2rem }
  .warning .title { font-weight: 600 }
  .warning .explain { margin: .15rem 0 .3rem; opacity: .85 }
  .warning .meta { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .3rem }
  .warning .chip { display: inline-block; padding: 0 .45rem; border-radius: 999px; background: var(--soft); font-size: 11px; border: 0 }
  .warning .chip.sev { background: color-mix(in oklab, #d0432b 18%, transparent); color: #d0432b; font-weight: 600 }
  .warning .chip.st-queued, .warning .chip.st-recurring, .warning .chip.st-unverified { background: color-mix(in oklab, var(--accent) 30%, transparent) }
  .warning code { display: block; font-size: 11px; opacity: .7; word-break: break-all; margin-bottom: .3rem }
  .warning .acts { display: flex; gap: .4rem }
  .warning .acts button { padding: .15rem .5rem; font-size: 12px }
  .overlay.gate { z-index: 48; background: color-mix(in oklab, Canvas 92%, transparent) }
  .wb { position: absolute; inset: 0; z-index: 60; background: Canvas }
  .wb[hidden] { display: none }
  .wb iframe { width: 100%; height: 100%; border: 0; display: block; background: transparent }
  .wb .close { position: absolute; top: .45rem; right: .6rem; z-index: 61; width: 32px; height: 32px; padding: 0; border-radius: 999px; font-size: 18px; line-height: 1; background: Canvas }
  .wb .wb-error { position: absolute; left: 1rem; right: 1rem; bottom: 1rem; padding: .6rem .75rem; border-radius: .5rem; background: color-mix(in oklab, #d0432b 14%, Canvas); color: #d0432b }
  .wb .wb-error[hidden] { display: none }
  .overlay .row { display: flex; gap: .5rem; justify-content: center; margin-top: .75rem }
  .overlay .row .secondary { opacity: .75 }
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
  .chips { display: flex; flex-direction: column; gap: .3rem }
  .chips:empty { display: none }
  .chip { display: flex; align-items: center; gap: .5rem; padding: .3rem .4rem; border-radius: .375rem; border: 1px solid var(--edge); font-size: 12px }
  .chip.error { border-color: #d0432b }
  .chip img { width: 32px; height: 32px; object-fit: cover; border-radius: .25rem }
  .chip .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600 }
  .chip .state { opacity: .7 } .chip.error .state { color: #d0432b; opacity: 1 }
  .chip button { padding: .1rem .4rem; font-size: 11px }
  .attach-row { display: flex; gap: .5rem; align-items: center; font-size: 12px }
  .attach-row .notice { opacity: .8; color: #d0432b }
  .pill img { width: 18px; height: 18px; object-fit: cover; border-radius: .2rem }
  .pill .more { font-size: 11px; opacity: .7 }
  form.dropping { outline: 2px dashed var(--accent); outline-offset: -4px }
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
  <button class="issues" id="issues" type="button" hidden aria-expanded="false" aria-controls="drawer" title="Layout issues the browser found; yours to queue or dismiss">Layout issues <span class="badge" id="issuesCount">0</span></button>
  <button class="mode" id="mode" type="button" aria-pressed="true" title="Toggle annotate/explore mode (⌘I / Ctrl+I)">Annotate</button>
  <button class="more" id="more" type="button" aria-label="More" aria-haspopup="menu">⋮</button>
</header>
<div class="menu" id="menu" role="menu">
  <div class="path" id="path"></div>
  <button type="button" id="copyPath">Copy directory path</button>
  <button type="button" id="reload">Reload prototype</button>
  <button type="button" id="copySnapshot">Copy DOM snapshot</button>
  <button type="button" id="exportHtml">Export standalone HTML</button>
  <button type="button" id="otherDevice" hidden>Open on another device</button>
  <div class="path" id="networkUrl" hidden></div>
  <button type="button" id="endSession" class="danger">End review</button>
</div>
<main>
  <!-- The sandbox list below deliberately withholds same-origin access: the document inside is
       model-written and must stay at an opaque origin, unable to read this page's token. The
       serving route repeats the restriction in a header, so it holds even when this page is
       bypassed and the prototype URL is opened directly. -->
  <div class="stage" id="stage">
    <iframe id="frame" sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe>
    <div class="overlay gate" id="gate"><div class="card"><h2 id="gateTitle">Checking layout…</h2><p id="gateCopy">Waiting for fonts and final geometry before showing the prototype.</p><div class="row"><button id="gateAction" type="button">Show anyway</button><button id="gateBypass" type="button" class="secondary" hidden>Show anyway</button></div></div></div>
    <div class="drawer" id="drawer" hidden role="region" aria-label="Layout issues">
      <div class="drawer-head">
        <label><input type="checkbox" id="issuesAll"> Select all</label>
        <span class="sum" id="issuesSummary"></span>
        <button type="button" class="close" id="issuesClose" aria-label="Close layout issues">×</button>
      </div>
      <div class="warnings" id="warnings"></div>
      <div class="drawer-foot">
        <span class="sel" id="issuesSelected">None selected</span>
        <button type="button" id="issuesQueue" class="send" disabled>Queue selected fixes</button>
      </div>
    </div>
  </div>
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
      <div class="chips" id="chips"></div>
      <div class="attach-row"><button type="button" id="attach">Attach images</button><input id="attachInput" type="file" multiple hidden><span class="notice" id="attachNotice" role="status"></span></div>
      <div class="hint" id="hint"></div>
      <div class="actions">
        <button id="hold" type="button" title="Keep this note in the queue and carry on; nothing is sent until you press Send">Hold</button>
        <button id="sendEnd" type="button" title="Send what is queued and end the review">Send &amp; End</button>
        <button id="send" type="submit" class="send">Send to Agent</button>
      </div>
    </form>
  </aside>
  <div class="overlay" id="ended"><div class="card"><h2 id="endedTitle">Review ended</h2><p id="endedCopy"></p></div></div>
  <!-- A diagram opened full screen. The same frame the prototype embeds inline, hosted here so
       it can be large; sandboxed exactly like the inline one, with no origin of its own. -->
  <div class="wb" id="whiteboardOverlay" hidden><iframe id="whiteboardFrame" sandbox="allow-scripts allow-popups" title="Whiteboard"></iframe><button type="button" class="close" id="whiteboardClose" aria-label="Close whiteboard">×</button><div class="wb-error" id="whiteboardError" hidden></div></div>
</main>
<script>
(() => {
  const config = ${config}
  const $ = (id) => document.getElementById(id)
  const frame = $("frame"), status = $("status"), text = $("text"), send = $("send"), sendEnd = $("sendEnd"), hold = $("hold")
  const modeButton = $("mode"), more = $("more"), menu = $("menu"), pills = $("pills"), scroll = $("scroll")
  const hint = $("hint"), presence = $("presence"), chips = $("chips"), attachButton = $("attach"), attachInput = $("attachInput"), attachNotice = $("attachNotice")
  const panel = $("panel"), panelHead = $("panelHead"), summary = $("summary"), toggle = $("toggle"), scrim = $("scrim")
  const endedOverlay = $("ended"), endedCopy = $("endedCopy")
  const issuesButton = $("issues"), issuesCount = $("issuesCount"), drawer = $("drawer"), warningsList = $("warnings")
  const issuesAll = $("issuesAll"), issuesSummary = $("issuesSummary"), issuesSelected = $("issuesSelected"), issuesQueue = $("issuesQueue"), issuesClose = $("issuesClose")
  const gate = $("gate"), gateTitle = $("gateTitle"), gateCopy = $("gateCopy"), gateAction = $("gateAction"), gateBypass = $("gateBypass")
  const wbOverlay = $("whiteboardOverlay"), wbFrame = $("whiteboardFrame"), wbClose = $("whiteboardClose"), wbError = $("whiteboardError")
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
  // The passive layout inbox, and the load each pass belongs to.
  let warnings = []
  let selectedIds = new Set((load("issues", []) || []).filter((x) => typeof x === "string"))
  let drawerOpen = false
  const loadClient = "c" + Math.random().toString(36).slice(2) + Date.now().toString(36)
  let loadSeq = 0
  let loadToken = ""
  let loadRetried = false
  let silenceTimer = 0, bootTimer = 0
  let reportedFailures = new Set()
  let gateOn = !!config.gate && !ended
  let gateBypassed = false
  let gateFailure = false
  let gateCycle = 0
  let gateTimer = 0
  const ACCEPTED = (config.attachments && config.attachments.accepted) || ["image/png", "image/jpeg", "image/webp"]
  const ACCEPTED_SET = new Set(ACCEPTED)
  const MAX_COUNT = (config.attachments && config.attachments.maxCount) || 4
  const MAX_BYTES = (config.attachments && config.attachments.maxBytes) || 0
  attachInput.accept = ACCEPTED.join(",")

  const tell = (type, payload) => { try { frame.contentWindow.postMessage({ source: "redcode-design-shell", type, payload: payload || {} }, "*") } catch {} }
  const api = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-redcode-design-token": config.token }, body: JSON.stringify(body || {}) })
  // Every load of the frame is named first: the server hands back a token that ties the passes
  // that document runs to it, so a frame replaced mid-flight cannot report on what nobody sees.
  const beginLoad = async () => {
    const seq = ++loadSeq
    try {
      const response = await api("/loads/begin", { client: loadClient, sequence: seq })
      const data = await response.json().catch(() => ({}))
      if (seq !== loadSeq) return null
      if (!response.ok || data.status === "out-of-order") return null
      if (typeof data.revision === "number") revision = data.revision
      return String(data.artifact_load_token || "")
    } catch { return seq === loadSeq ? "" : null }
  }
  const frameSrc = () => base + "/files/index.html?rev=" + revision + (loadToken ? "&load=" + encodeURIComponent(loadToken) : "")
  const loadFrame = async () => {
    const token = await beginLoad()
    if (token === null) return
    loadToken = token
    loadRetried = false
    reportedFailures = new Set()
    // The inline whiteboards go with the document; the next ones introduce themselves again.
    inlineChannels.clear()
    startGate()
    armSilence()
    frame.src = frameSrc()
  }
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
    if (t && t.type === "excalidraw-scene") return "whiteboard: diagram " + (Number(t.diagramIndex) + 1)
    if (item.tag === "layout-warnings") return "layout fixes: " + ((t && Array.isArray(t.warnings) && t.warnings.length) || 0)
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
  const thumb = (id) => base + "/attachments/" + encodeURIComponent(id) + "?token=" + encodeURIComponent(config.token)
  const drawPills = () => {
    pills.replaceChildren(...pending.map((item, index) => {
      const pill = document.createElement("div")
      pill.className = "pill"
      pill.tabIndex = 0
      const at = where(item)
      const label = document.createElement("span")
      label.textContent = (at ? at + " · " : "") + (item.text || (item.attachments && item.attachments.length ? "Image" : ""))
      const refs = Array.isArray(item.attachments) ? item.attachments : []
      const imgs = refs.slice(0, 4).map((a) => { const img = document.createElement("img"); img.src = thumb(a.id); img.alt = ""; return img })
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
      pill.append(label, ...imgs)
      if (refs.length > 4) { const more = document.createElement("span"); more.className = "more"; more.textContent = "+" + (refs.length - 4); pill.append(more) }
      pill.append(remove, tip)
      return pill
    }))
  }
  const draw = () => {
    drawPills()
    drawWarnings()
    const typed = text.value.trim() !== "" || composerImages.hasReady()
    send.disabled = !!ended || (pending.length === 0 && !typed)
    sendEnd.disabled = !!ended
    hold.disabled = !!ended || !typed
    const count = pending.length + (typed ? 1 : 0)
    send.textContent = count > 1 ? "Send " + count + " notes" : "Send to Agent"
    drawSummary()
  }
  const enqueue = (p) => {
    if (!p || typeof p !== "object" || ended) return
    const words = String(p.prompt || "").slice(0, 4000)
    const item = {
      selector: String(p.selector || "").slice(0, 512),
      tag: String(p.tag || "").slice(0, 40),
      elementText: String(p.text || "").slice(0, 240),
      text: words,
      ...(p.target && typeof p.target === "object" ? { target: p.target } : {}),
      ...(p.queueKey ? { queueKey: String(p.queueKey).slice(0, 200) } : {}),
      ...(Array.isArray(p.attachments) && p.attachments.length
        ? { attachments: p.attachments.filter((a) => a && typeof a.id === "string").slice(0, MAX_COUNT).map((a) => (a.name ? { id: a.id, name: String(a.name).slice(0, 200) } : { id: a.id })) }
        : {}),
    }
    if (!item.text.trim() && !item.attachments) return
    const at = item.queueKey ? pending.findIndex((x) => x.queueKey === item.queueKey) : -1
    pending = at >= 0 ? pending.map((x, i) => (i === at ? item : x)) : pending.concat([item]).slice(0, 50)
    persistQueue()
    draw()
    pulse()
    status.textContent = pending.length + " queued · press Send when you are done"
  }

  // --- images beside the composer -------------------------------------------------------------
  // The same chips the card has, for the composer: captured here, uploaded here, and carried on
  // the message as ids the server re-derives from disk.
  const formatLimit = (bytes) => (bytes >= 1024 * 1024 ? Math.round(bytes / (1024 * 1024)) + " MB" : bytes >= 1024 ? Math.round(bytes / 1024) + " KB" : bytes + " bytes")
  const composerImages = (() => {
    const items = []
    let nextId = 0
    let capRejected = false
    let sendBlocked = false
    const imageCount = () => items.filter((item) => item.file).length
    const render = () => {
      if (imageCount() < MAX_COUNT) capRejected = false
      const pending = items.some((item) => item.status === "uploading")
      const errored = items.some((item) => item.status === "error")
      if (!pending && !errored) sendBlocked = false
      attachNotice.textContent = sendBlocked && pending ? "Waiting for an image to finish uploading…" : sendBlocked && errored ? "An image couldn't be attached. Retry or remove it before sending." : capRejected ? "You can attach up to " + MAX_COUNT + " image" + (MAX_COUNT === 1 ? "" : "s") + "." : ""
      chips.replaceChildren(...items.map((item) => {
        const el = document.createElement("div")
        el.className = "chip " + item.status
        if (item.preview) { const img = document.createElement("img"); img.src = item.preview; img.alt = ""; el.append(img) }
        const name = document.createElement("span"); name.className = "name"; name.textContent = item.name; el.append(name)
        const state = document.createElement("span"); state.className = "state"; state.textContent = item.status === "uploading" ? "Uploading…" : item.status === "error" ? item.error : ""; el.append(state)
        if (item.status === "error" && item.file) { const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry"; retry.addEventListener("click", () => start(item)); el.append(retry) }
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove " + item.name); remove.addEventListener("click", () => { const at = items.indexOf(item); if (at >= 0) items.splice(at, 1); if (item.abort) item.abort.abort(); if (item.preview) URL.revokeObjectURL(item.preview); render(); draw() }); el.append(remove)
        return el
      }))
      draw()
    }
    const start = async (item) => {
      const abort = new AbortController()
      item.abort = abort
      item.status = "uploading"
      item.error = ""
      render()
      try {
        const bytes = await item.file.arrayBuffer()
        if (!items.includes(item)) return
        await upload({ localId: item.localId, bytes, mime: item.file.type }, (result) => {
          if (!items.includes(item)) return
          if (result.ok && result.id) { item.status = "ready"; item.id = result.id } else { item.status = "error"; item.error = String(result.error || "Upload failed") }
          render()
        }, abort.signal)
      } catch (error) {
        if (!items.includes(item)) return
        item.status = "error"
        item.error = error instanceof Error ? error.message : String(error)
        render()
      }
    }
    const addFiles = (files) => {
      let added = false
      let count = imageCount()
      for (const file of Array.from(files || [])) {
        if (!ACCEPTED_SET.has(String(file.type || ""))) continue
        const tooLarge = MAX_BYTES > 0 && Number(file.size) > MAX_BYTES
        if (!tooLarge && count >= MAX_COUNT) { capRejected = true; continue }
        const item = { localId: String(nextId++), file: tooLarge ? null : file, name: String(file.name || "image"), preview: tooLarge ? "" : URL.createObjectURL(file), status: tooLarge ? "error" : "uploading", error: tooLarge ? "Image is larger than the " + formatLimit(MAX_BYTES) + " limit" : "", id: "", abort: null }
        items.push(item)
        if (!tooLarge) count += 1
        added = true
        if (!tooLarge) start(item)
      }
      render()
      return added
    }
    const rejectUnsupported = (files) => {
      for (const file of Array.from(files || [])) {
        if (ACCEPTED_SET.has(String(file.type || ""))) continue
        items.push({ localId: String(nextId++), file: null, name: String(file.name || "file"), preview: "", status: "error", error: "Unsupported file type. Use " + ACCEPTED.map((m) => m.split("/")[1].toUpperCase()).join(", ") + ".", id: "", abort: null })
      }
      render()
    }
    return {
      addFiles, rejectUnsupported,
      hasPending: () => items.some((item) => item.status === "uploading"),
      hasErrors: () => items.some((item) => item.status === "error"),
      hasReady: () => items.some((item) => item.status === "ready"),
      noteSendBlocked: () => { sendBlocked = true; render() },
      collectReady: () => items.filter((item) => item.status === "ready").map((item) => ({ id: item.id, name: item.name })),
      reset: () => { for (const item of items) { if (item.abort) item.abort.abort(); if (item.preview) URL.revokeObjectURL(item.preview) } items.length = 0; capRejected = false; sendBlocked = false; render() },
    }
  })()

  // The upload itself, for the composer and for the frame (which has no network). Bounded before
  // it touches the network: a page that posts a flood of uploads gets refusals, not a stall.
  const uploadTimestamps = []
  let uploadedBytesTotal = 0
  let uploadsInFlight = 0
  const upload = async (message, report, signal) => {
    const bytes = message.bytes
    let size
    try { size = ArrayBuffer.isView(bytes) ? bytes.byteLength : Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get.call(bytes) } catch { size = NaN }
    if (!Number.isFinite(size) || size < 0) return report({ ok: false, error: "invalid upload payload" })
    if (MAX_BYTES > 0 && size > MAX_BYTES) return report({ ok: false, error: "Image is larger than the " + formatLimit(MAX_BYTES) + " limit" })
    const now = Date.now()
    while (uploadTimestamps.length && now - uploadTimestamps[0] > ${UPLOAD_RATE_WINDOW_MS}) uploadTimestamps.shift()
    if (uploadTimestamps.length >= ${UPLOAD_RATE_MAX}) return report({ ok: false, error: "Too many uploads. Wait a moment and retry." })
    if (uploadedBytesTotal + size > ${UPLOAD_SESSION_BYTE_QUOTA}) return report({ ok: false, error: "Upload limit reached for this page (" + formatLimit(${UPLOAD_SESSION_BYTE_QUOTA}) + ")." })
    if (uploadsInFlight >= ${UPLOAD_MAX_IN_FLIGHT}) return report({ ok: false, error: "Too many uploads in flight. Wait a moment and retry." })
    uploadTimestamps.push(now)
    uploadedBytesTotal += size
    uploadsInFlight += 1
    try {
      const response = await fetch(base + "/attachments", { method: "POST", headers: { "content-type": String(message.mime || "application/octet-stream"), "x-redcode-design-token": config.token }, body: bytes, signal })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Upload failed")
      report({ ok: true, id: (data.attachment && data.attachment.id) || "" })
    } catch (error) {
      report({ ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      uploadsInFlight -= 1
    }
  }
  const files = (dt) => { const list = Array.from((dt && dt.files) || []).filter(Boolean); if (list.length) return list; return Array.from((dt && dt.items) || []).filter((i) => i && i.kind === "file").map((i) => i.getAsFile()).filter(Boolean) }
  const keepsText = (value, picked) => {
    const lines = String(value).split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return false
    const names = picked.map((f) => String((f && f.name) || "")).filter(Boolean)
    if (!names.length) return true
    return !lines.every((line) => names.some((name) => line === name || line.endsWith("/" + name) || line.endsWith("\\\\" + name)))
  }
  attachButton.addEventListener("click", () => attachInput.click())
  attachInput.addEventListener("change", () => { composerImages.addFiles(attachInput.files); composerImages.rejectUnsupported(attachInput.files); attachInput.value = "" })
  text.addEventListener("paste", (event) => {
    const picked = files(event.clipboardData)
    const added = composerImages.addFiles(picked)
    if (added && !keepsText(event.clipboardData && event.clipboardData.getData("text/plain") || "", picked)) event.preventDefault()
  })
  const composer = $("composer")
  composer.addEventListener("dragover", (event) => { if (Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files")) { event.preventDefault(); composer.classList.add("dropping") } })
  composer.addEventListener("dragleave", (event) => { if (!composer.contains(event.relatedTarget)) composer.classList.remove("dropping") })
  composer.addEventListener("drop", (event) => {
    composer.classList.remove("dropping")
    if (!Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files")) return
    event.preventDefault()
    const picked = files(event.dataTransfer)
    if (!picked.length) { composerImages.rejectUnsupported([{ name: "file", type: "" }]); return }
    composerImages.addFiles(picked)
    composerImages.rejectUnsupported(picked)
  })
  // A drop that misses the composer must not navigate this page away from the review.
  document.addEventListener("dragover", (event) => { if (Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files")) event.preventDefault() })
  document.addEventListener("drop", (event) => { if (Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files")) event.preventDefault() })

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
    if (event.key === "Escape") { closeMenu(); if (overlayIndex !== null) { closeWhiteboard(); return } if (drawerOpen) { setDrawer(false); issuesButton.focus() } if (sheetOpen) setSheet(false); return }
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
  // One file with everything local inside it, handed to the browser as a download. The server
  // says what did not make it in, and so does the hint.
  $("exportHtml").addEventListener("click", async () => {
    closeMenu()
    const button = $("exportHtml")
    button.disabled = true
    status.textContent = "exporting…"
    try {
      const response = await fetch(base + "/export", { headers: { "x-redcode-design-token": config.token } })
      if (!response.ok) throw new Error("HTTP " + response.status)
      const blob = await response.blob()
      const unresolved = Number(response.headers.get("x-redcode-export-warning-count")) || 0
      const notices = Number(response.headers.get("x-redcode-export-notice-count")) || 0
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = (config.name || "prototype").replace(/[\\/:*?"<>|]+/g, "_").replace(/\.html?$/i, "") + ".export.html"
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 10000)
      const parts = []
      if (unresolved) parts.push(unresolved === 1 ? "1 unresolved asset" : unresolved + " unresolved assets")
      if (notices) parts.push(notices === 1 ? "1 notice" : notices + " notices")
      status.textContent = parts.length ? "exported with " + parts.join(" and ") : "exported"
      note(parts.length ? "Exported with " + parts.join(" and ") + ". A local file that could not be inlined needs to sit beside the export." : "Exported.", unresolved > 0)
    } catch (error) { note("Could not export (" + error.message + ").", true); status.textContent = "export failed" }
    finally { button.disabled = false }
  })
  // The same review from a phone on the same network: the URL is the server's, and only shown
  // when the server listens somewhere a phone can reach.
  if (config.networkUrl) {
    $("otherDevice").hidden = false
    $("networkUrl").hidden = false
    $("networkUrl").textContent = config.networkUrl
    $("otherDevice").addEventListener("click", async () => { closeMenu(); try { await navigator.clipboard.writeText(config.networkUrl); note("link copied · open it on the other device") } catch { note(config.networkUrl, false) } })
  }

  // --- the review ends -------------------------------------------------------------------------
  const markEnded = (by) => {
    ended = by || "user"
    document.body.setAttribute("data-ended", ended)
    endedCopy.textContent = ended === "agent" ? "The agent finished this review. Nothing more is sent from here." : "You ended this review. Nothing more is sent from here."
    endedOverlay.setAttribute("data-on", "")
    closeMenu()
    if (overlayIndex !== null) finishWhiteboardClose(overlayIndex)
    setDrawer(false)
    gateBypassed = true
    gateFailure = false
    revealGate()
    setMode(false)
    presence.hidden = true
    draw()
    drawChat()
    applySheet()
  }
  const endReview = async () => {
    if (ended) return
    if (pending.length || text.value.trim() || composerImages.hasReady()) { await submit(undefined, true); return }
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
        clearTimeout(silenceTimer); clearTimeout(bootTimer)
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
      case "layoutDiagnostics": onDiagnostics(payload); return
      case "artifactAssetFailure": reportFailures([{ kind: "artifact-asset-unavailable", detail: String(payload.detail || "a local asset failed to load").slice(0, 300) }]); return
      case "uploadAttachment": {
        // The frame captured the bytes; this page uploads them and echoes the nonce back untouched.
        const localId = String(payload.localId || "")
        if (!localId) return
        upload({ localId, bytes: payload.bytes, mime: payload.mime }, (result) => tell("attachmentResult", { nonce: payload.nonce, localId, ...result }))
        return
      }
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
    // What was typed joins the queue first, so a failure past this point loses nothing. A chip
    // still uploading or failed holds back only the composer's own message.
    const blocked = composerImages.hasPending() || composerImages.hasErrors()
    if (blocked) composerImages.noteSendBlocked()
    const typed = text.value.trim()
    const ready = blocked ? [] : composerImages.collectReady()
    if (!blocked && (typed || ready.length)) {
      pending = pending.concat([{ tag: "message", text: typed || "See the attached image.", ...(ready.length ? { attachments: ready } : {}) }]).slice(0, 50)
      persistQueue()
      text.value = ""
      composerImages.reset()
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
        if (response.status === 400) {
          const detail = await response.json().catch(() => ({}))
          throw new Error(detail.error || "the server refused the batch")
        }
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
    if (composerImages.hasPending() || composerImages.hasErrors()) { composerImages.noteSendBlocked(); return }
    const ready = composerImages.collectReady()
    if (!typed && !ready.length) return
    pending = pending.concat([{ tag: "message", text: typed || "See the attached image.", ...(ready.length ? { attachments: ready } : {}) }]).slice(0, 50)
    persistQueue()
    text.value = ""
    composerImages.reset()
    draw()
    status.textContent = pending.length + " held · press Send when you are done"
  })
  text.addEventListener("input", draw)
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit() }
  })

  // --- the curtain -----------------------------------------------------------------------------
  // Held until the first layout pass, so a person never judges a page mid-layout. It never waits
  // on the network: the frame's own pass is the release, and a timer is the way out of anything.
  const clearGateTimer = () => { clearTimeout(gateTimer); gateTimer = 0 }
  const setGate = (on) => { gate.toggleAttribute("data-on", !!on) }
  const armGateTimer = () => {
    clearGateTimer()
    const cycle = gateCycle
    gateTimer = setTimeout(() => { if (cycle === gateCycle) revealGate() }, config.gateTimeoutMs || ${GATE_TIMEOUT_MS})
  }
  const revealGate = () => { clearGateTimer(); setGate(false) }
  const bypassGate = () => { gateBypassed = true; gateFailure = false; revealGate() }
  const setGateChecking = () => {
    gateTitle.textContent = "Checking layout…"
    gateCopy.textContent = "Waiting for fonts and final geometry before showing the prototype."
    gateAction.textContent = "Show anyway"
    gateAction.disabled = false
    gateAction.onclick = bypassGate
    gateBypass.hidden = true
  }
  const startGate = () => {
    gateFailure = false
    gateCycle += 1
    if (!gateOn || gateBypassed || ended) { revealGate(); return }
    setGateChecking()
    setGate(true)
    armGateTimer()
  }
  // The one thing this page cannot work around: the frame never loaded. The same card, with a
  // way out that asks the server first, because a reload into a dead port is worse than waiting.
  const setGateFailure = (title, copy, actionLabel, onAction) => {
    if (ended) return
    gateFailure = true
    gateCycle += 1
    gateTitle.textContent = title
    gateCopy.textContent = copy
    gateAction.textContent = actionLabel
    gateAction.disabled = false
    gateAction.onclick = onAction
    gateBypass.hidden = false
    gateBypass.onclick = bypassGate
    setGate(true)
    armGateTimer()
  }
  const checkServerThenReload = (stillDown) => async () => {
    gateAction.disabled = true
    const cycle = gateCycle
    try {
      const response = await fetch(base + "/revision", { headers: { "x-redcode-design-token": config.token }, cache: "no-store" })
      if (response.ok) { loadFrame(); return }
      if (cycle === gateCycle) gateCopy.textContent = stillDown
    } catch {
      if (cycle === gateCycle) gateCopy.textContent = "The server is not answering. Check that redcode is still running, then try again."
    } finally { gateAction.disabled = false }
  }
  gateAction.onclick = bypassGate
  gateBypass.onclick = bypassGate

  // --- when the frame says nothing --------------------------------------------------------------
  // A healthy prototype boots its SDK within seconds. Silence is the one signal that separates
  // "the review is unusable" from "the review has layout problems", and only that reaches the agent.
  const armSilence = () => {
    clearTimeout(silenceTimer); clearTimeout(bootTimer)
    const token = loadToken
    silenceTimer = setTimeout(async () => {
      if (token !== loadToken || !token) return
      try {
        const response = await fetch(frameSrc() + "&probe=1", { cache: "no-store" })
        if (token !== loadToken || response.status === 409 || response.ok) return
        const detail = "the prototype's document responded with HTTP " + response.status
        reportFailures([{ kind: "artifact-unavailable", detail }])
        setGateFailure("The prototype could not be loaded", "The server answered HTTP " + response.status + " for index.html. The agent has been told.", "Retry", checkServerThenReload("Still failing. The agent has been told; try again once it has revised the prototype."))
      } catch {}
    }, ${ARTIFACT_SILENCE_PROBE_MS})
    bootTimer = setTimeout(() => {
      if (token !== loadToken || gateFailure) return
      setGateFailure("The prototype has not finished loading", "It has been quiet for a while. A script in it may have failed before the review tools started.", "Reload", checkServerThenReload("The server is up but the prototype still did not start. Look at the browser console for an error in it."))
    }, ${ARTIFACT_BOOT_FAILSAFE_MS})
  }
  const reportFailures = (failures) => {
    if (ended || !loadToken) return
    const fresh = failures.filter((f) => { const k = f.kind + "|" + f.detail; if (reportedFailures.has(k)) return false; reportedFailures.add(k); return true })
    if (!fresh.length) return
    api("/artifact-failures", { failures: fresh, artifact_load_token: loadToken, artifact_revision: revision }).catch(() => {})
  }

  // --- the passive layout inbox -----------------------------------------------------------------
  // The frame audits itself and reports; this page hands the pass to the server, which folds it
  // into the warnings and hands back what to show. Nothing here starts a turn.
  const onDiagnostics = async (payload) => {
    revealGate()
    if (!loadToken) return
    const token = loadToken
    try {
      const response = await api("/layout-diagnostics", {
        complete: payload.complete !== false,
        target_presence_complete: payload.target_presence_complete === true,
        artifact_revision: Number(payload.artifact_revision) || 0,
        artifact_load_token: token,
        artifact_pass_sequence: Number(payload.artifact_pass_sequence) || 0,
        viewport_width: Number(payload.viewport_width) || 0,
        findings: Array.isArray(payload.findings) ? payload.findings.filter((f) => f && typeof f === "object" && f.severity === "error").slice(0, 200) : [],
      })
      const data = await response.json().catch(() => ({}))
      if (token !== loadToken) return
      if (Array.isArray(data.warnings)) setWarnings(data.warnings)
      // The server forgot this load (it restarted): name the load again and ask for a fresh pass.
      if (data.status === "stale" && !loadRetried) {
        loadRetried = true
        const again = await beginLoad()
        if (again) { loadToken = again; tell("requestLayoutDiagnostics") }
      }
    } catch {}
  }
  const pendingWarningIds = () => {
    const ids = new Set()
    for (const item of pending) {
      if (item.tag !== "layout-warnings" || !item.target || !Array.isArray(item.target.warnings)) continue
      for (const w of item.target.warnings) if (w && w.id) ids.add(String(w.id))
    }
    return ids
  }
  const activeWarnings = () => warnings.filter((w) => w && w.active)
  const selectable = () => { const held = pendingWarningIds(); return activeWarnings().filter((w) => w.selectable && !held.has(w.id)) }
  const persistSelection = () => save("issues", selectedIds.size ? [...selectedIds] : null)
  const setWarnings = (next) => {
    warnings = Array.isArray(next) ? next.filter((w) => w && typeof w === "object" && typeof w.id === "string") : []
    const ok = new Set(selectable().map((w) => w.id))
    for (const id of [...selectedIds]) if (!ok.has(id)) selectedIds.delete(id)
    persistSelection()
    drawWarnings()
  }
  const ago = (value) => {
    const at = Date.parse(String(value || ""))
    if (!Number.isFinite(at)) return ""
    const s = Math.max(0, Math.round((Date.now() - at) / 1000))
    if (s < 45) return "just now"
    const m = Math.round(s / 60); if (m < 60) return m + "m ago"
    const h = Math.round(m / 60); if (h < 24) return h + "h ago"
    return Math.round(h / 24) + "d ago"
  }
  const chip = (label, cls) => { const el = document.createElement("span"); el.className = "chip" + (cls ? " " + cls : ""); el.textContent = label; return el }
  const warningRow = (w) => {
    const held = pendingWarningIds().has(w.id)
    const can = !!w.selectable && !held
    const row = document.createElement("div")
    row.className = "warning" + (w.outstanding ? " outstanding" : "")
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = can && selectedIds.has(w.id)
    box.disabled = !can
    box.setAttribute("aria-label", (can ? "Select " : "") + w.title + " on " + w.viewport_label + (can ? "" : held ? " (queued to send)" : " (a fix is already queued)"))
    box.addEventListener("change", () => { if (box.checked) selectedIds.add(w.id); else selectedIds.delete(w.id); persistSelection(); drawSelection() })
    const body = document.createElement("div")
    const title = document.createElement("div"); title.className = "title"; title.textContent = w.title
    const explain = document.createElement("div"); explain.className = "explain"; explain.textContent = w.explanation
    const meta = document.createElement("div"); meta.className = "meta"
    meta.append(chip("Severe", "sev"), chip(held ? "Queued to send" : w.status_label, "st-" + w.status), chip(w.viewport_label + " · " + w.viewport_width + "px"))
    const seen = ago(w.last_seen_at); if (seen) meta.append(chip("Seen " + seen))
    const target = document.createElement("code"); target.textContent = w.selector || "(whole page)"
    const acts = document.createElement("div"); acts.className = "acts"
    if (w.selector) { const reveal = document.createElement("button"); reveal.type = "button"; reveal.textContent = "Reveal"; reveal.addEventListener("click", () => tell("revealElement", { selector: w.selector })); acts.append(reveal) }
    const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = "Dismiss"; dismiss.disabled = !can
    dismiss.title = can ? "Hide this for the current revision; it comes back if a later revision still has it" : "Cannot be dismissed while a fix is queued"
    dismiss.addEventListener("click", () => dismissWarning(w.id))
    acts.append(dismiss)
    body.append(title, explain, meta, target, acts)
    row.append(box, body)
    return row
  }
  const drawSelection = () => {
    const can = selectable()
    const count = can.filter((w) => selectedIds.has(w.id)).length
    issuesAll.disabled = can.length === 0
    issuesAll.checked = can.length > 0 && count === can.length
    issuesAll.indeterminate = count > 0 && count < can.length
    issuesSelected.textContent = count === 0 ? "None selected" : count + " selected"
    issuesQueue.disabled = count === 0 || !!ended
  }
  const drawWarnings = () => {
    const held = pendingWarningIds()
    let changed = false
    for (const id of [...selectedIds]) if (held.has(id)) { selectedIds.delete(id); changed = true }
    if (changed) persistSelection()
    const active = activeWarnings()
    issuesButton.hidden = active.length === 0 || !!ended
    if (issuesButton.hidden && drawerOpen) setDrawer(false)
    issuesCount.textContent = String(active.length)
    issuesButton.setAttribute("aria-label", active.length === 1 ? "1 unresolved layout issue" : active.length + " unresolved layout issues")
    const outstanding = active.filter((w) => w.outstanding).length
    issuesSummary.textContent = (active.length === 1 ? "1 unresolved issue" : active.length + " unresolved issues") + (outstanding ? " · " + outstanding + " already queued for a fix" : "")
    if (active.length === 0) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "No unresolved layout issues."; warningsList.replaceChildren(empty) }
    else warningsList.replaceChildren(...active.map(warningRow))
    drawSelection()
  }
  const setDrawer = (open) => {
    drawerOpen = !!open && !ended
    drawer.hidden = !drawerOpen
    issuesButton.setAttribute("aria-expanded", String(drawerOpen))
    if (drawerOpen) { closeMenu(); tell("requestLayoutDiagnostics"); issuesAll.focus() }
  }
  issuesButton.addEventListener("click", () => setDrawer(drawer.hidden))
  issuesClose.addEventListener("click", () => { setDrawer(false); issuesButton.focus() })
  issuesAll.addEventListener("change", () => { for (const w of selectable()) { if (issuesAll.checked) selectedIds.add(w.id); else selectedIds.delete(w.id) } persistSelection(); drawWarnings() })
  const dismissWarning = async (id) => {
    try {
      const response = await api("/layout-warnings/dismiss", { id })
      if (!response.ok) return
      const data = await response.json()
      if (Array.isArray(data.warnings)) setWarnings(data.warnings)
    } catch {}
  }
  // One queued batch is one ordinary note in the queue: the agent cannot tell it apart from any
  // other feedback, which is the point. The warnings become repair requests when it is delivered.
  issuesQueue.addEventListener("click", async () => {
    if (ended) return
    const ids = [...selectedIds]
    if (!ids.length) return
    issuesQueue.disabled = true
    try {
      const response = await api("/layout-warnings/queue", { ids, revision })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409) { note("The prototype changed while you chose; the list was refreshed.", true); if (typeof data.revision === "number") revision = data.revision; refreshWarnings(); return }
      if (!response.ok) throw new Error(data.error || "HTTP " + response.status)
      if (data.prompt) enqueue({ selector: "", tag: "layout-warnings", text: data.prompt.text, prompt: data.prompt.prompt, target: data.prompt.target })
      selectedIds.clear()
      persistSelection()
      if (Array.isArray(data.warnings)) setWarnings(data.warnings)
      setDrawer(false)
      issuesButton.focus()
    } catch (error) { note("Could not queue the fixes (" + error.message + ").", true) }
    finally { drawSelection() }
  })
  const refreshWarnings = async () => {
    try {
      const response = await fetch(base + "/layout-warnings", { headers: { "x-redcode-design-token": config.token } })
      if (!response.ok) return
      const data = await response.json()
      if (Array.isArray(data.warnings)) setWarnings(data.warnings)
    } catch {}
  }

  // --- whiteboards -----------------------------------------------------------------------------
  // Diagrams open as Excalidraw scenes: inline, in a frame the prototype embeds beside each one,
  // or full screen in the overlay above. The frames hold no server access; every read and write
  // goes through this page, and only for a frame that proved its channel and its descent.
  const whiteboards = new Map()
  let overlayIndex = null, overlayReady = false, overlayChannel = "", overlayOpening = null, nextFlushId = 0
  const teardowns = new Map(), flushes = new Map(), saveChains = new Map(), inlineChannels = new Map()
  const wbTheme = () => (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  const postOverlay = (m) => { if (wbFrame.contentWindow && overlayChannel) wbFrame.contentWindow.postMessage({ ...m, channelId: overlayChannel }, "*") }
  const postInline = (index, m) => { const c = inlineChannels.get(index); if (c && c.window) c.window.postMessage({ ...m, channelId: c.channelId }, "*") }
  const postWb = (index, placement, m) => { if (placement === "overlay") postOverlay(m); else postInline(index, m) }
  const fetchSources = async () => {
    const response = await fetch(base + "/mermaid-sources", { headers: { "x-redcode-design-token": config.token } })
    if (!response.ok) throw new Error("could not read the prototype's Mermaid sources")
    const data = await response.json()
    return Array.isArray(data.sources) ? data.sources : []
  }
  const authenticate = async (token) => { try { return (await api("/whiteboard-channel", { token })).ok } catch { return false } }
  const showWbError = (message) => { wbError.textContent = message; wbError.hidden = false; wbOverlay.hidden = false }
  const wbRecord = (index) => { let r = whiteboards.get(index); if (!r) { r = { diagramId: "", source: "", sourceHash: "" }; whiteboards.set(index, r) } return r }
  const wbReady = async (index, mode, isCurrent) => {
    try {
      const sources = await fetchSources()
      const source = sources.find((item) => item.index === index)
      if (!source) throw new Error("this diagram's Mermaid source was not found in the prototype")
      const savedResponse = await fetch(base + "/whiteboard/" + index, { headers: { "x-redcode-design-token": config.token } })
      const saved = savedResponse.ok ? (await savedResponse.json()).whiteboard : null
      const record = wbRecord(index)
      record.source = String(source.source || "")
      record.sourceHash = String(source.hash || "")
      if (!isCurrent()) return false
      postWb(index, mode, { type: "redcode-whiteboard:init", mode, diagramIndex: index, diagramId: record.diagramId, source: record.source, sourceHash: record.sourceHash, saved, theme: wbTheme() })
      return true
    } catch (error) {
      if (mode === "overlay") showWbError("Could not open the whiteboard: " + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }
  const showOverlay = (index) => {
    if (ended) return
    overlayIndex = index
    overlayReady = false
    overlayChannel = ""
    inlineChannels.delete(index)
    wbError.hidden = true
    wbOverlay.hidden = false
    tell("suspendWhiteboard", { diagramIndex: index })
    // A fresh document per open: it boots, says ready, and is initialised; nothing leaks between opens.
    wbFrame.src = base + "/whiteboard?" + new URLSearchParams({ index: String(index), diagramId: wbRecord(index).diagramId })
    wbClose.focus()
  }
  const finishWhiteboardClose = (index) => {
    wbOverlay.hidden = true
    wbError.hidden = true
    wbFrame.src = "about:blank"
    overlayIndex = null
    overlayReady = false
    overlayChannel = ""
    inlineChannels.delete(index)
    if (!ended) tell("resumeWhiteboard", { diagramIndex: index })
  }
  const teardownKey = (index, placement) => placement + ":" + index
  const beginTeardown = (index, placement, onComplete) => {
    const key = teardownKey(index, placement)
    const pending = teardowns.get(key)
    if (pending) { if (onComplete) pending.promise.then(onComplete); return pending.promise }
    const flushId = "whiteboard-" + ++nextFlushId
    let resolve
    const promise = new Promise((complete) => { resolve = complete })
    teardowns.set(key, { index, placement, flushId, promise, resolve, onComplete })
    postWb(index, placement, { type: "redcode-whiteboard:prepareTeardown", flushId })
    return promise
  }
  const settleTeardown = (index, message, placement, ok) => {
    const key = teardownKey(index, placement)
    const teardown = teardowns.get(key)
    if (!teardown || teardown.flushId !== String(message.flushId || "")) return
    teardowns.delete(key)
    if (teardown.onComplete) teardown.onComplete(ok)
    teardown.resolve(ok)
  }
  const beginFlush = (index, placement) => {
    const key = teardownKey(index, placement)
    const pending = flushes.get(key)
    if (pending) return pending.promise
    const flushId = "whiteboard-flush-" + ++nextFlushId
    let resolve
    const promise = new Promise((complete) => { resolve = complete })
    flushes.set(key, { flushId, promise, resolve })
    postWb(index, placement, { type: "redcode-whiteboard:flush", flushId })
    return promise
  }
  const finishFlush = (index, message, placement) => {
    const key = teardownKey(index, placement)
    const flush = flushes.get(key)
    if (!flush || flush.flushId !== String(message.flushId || "")) return
    flushes.delete(key)
    flush.resolve(!!message.ok)
  }
  const flushWhiteboards = async () => {
    const waits = []
    for (const [index, channel] of inlineChannels) if (channel.initialized && index !== overlayIndex) waits.push(beginFlush(index, "inline"))
    if (overlayIndex !== null && overlayReady) waits.push(beginFlush(overlayIndex, "overlay"))
    if (!waits.length) return
    let timer
    await Promise.race([Promise.all(waits), new Promise((resolve) => { timer = setTimeout(resolve, ${WHITEBOARD_FLUSH_MS}) })])
    clearTimeout(timer)
  }
  const openOverlay = (index) => {
    if (ended || overlayIndex !== null || overlayOpening !== null) return
    overlayOpening = index
    beginTeardown(index, "inline", (flushed) => {
      if (overlayOpening !== index) return
      overlayOpening = null
      if (flushed && !ended && overlayIndex === null) showOverlay(index)
    })
  }
  const closeWhiteboard = () => {
    const index = overlayIndex
    if (index === null) return
    if (!overlayReady) { finishWhiteboardClose(index); return }
    beginTeardown(index, "overlay", (flushed) => { if (flushed && overlayIndex === index) finishWhiteboardClose(index) })
  }
  const persistScene = async (index, message) => {
    const response = await fetch(base + "/whiteboard/" + index, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-redcode-design-token": config.token },
      body: JSON.stringify({ source_hash: String(message.sourceHash || ""), text_metrics_version: Number(message.textMetricsVersion) || 0, scene: message.scene || null, baseline: message.baseline || null }),
    })
    if (!response.ok) throw new Error("failed to save the whiteboard scene")
  }
  const saveScene = (index, message) => {
    const previous = saveChains.get(index) || Promise.resolve()
    const result = previous.catch(() => {}).then(() => persistScene(index, message))
    const tail = result.catch(() => {})
    saveChains.set(index, tail)
    tail.finally(() => { if (saveChains.get(index) === tail) saveChains.delete(index) })
    return result
  }
  const handleSave = (index, message, mode) => {
    const flushId = String(message.flushId || "")
    saveScene(index, message).then(
      () => { if (flushId) postWb(index, mode, { type: "redcode-whiteboard:saveResult", flushId, ok: true }) },
      (error) => { if (flushId) postWb(index, mode, { type: "redcode-whiteboard:saveResult", flushId, ok: false, error: error instanceof Error ? error.message : String(error) }) },
    )
  }
  // One queued whiteboard is one ordinary note: the summary of what moved, and where the scene
  // and its preview are. Queueing the same diagram again before sending replaces the earlier note.
  const queueWhiteboard = async (index, message, mode) => {
    const diagramId = wbRecord(index).diagramId
    try {
      await saveScene(index, message)
      const response = await api("/whiteboard/" + index + "/feedback-files", { scene: message.scene || null, pngDataUrl: String(message.pngDataUrl || "") })
      if (!response.ok) throw new Error("failed to write the whiteboard files")
      const files = await response.json()
      const wbNote = String(message.note || "").slice(0, 4000)
      const summary = (Array.isArray(message.summaryLines) ? message.summaryLines : []).filter((line) => typeof line === "string").slice(0, 50).map((line) => line.slice(0, 300)).join("\\n")
      const promptText = (wbNote ? wbNote + "\\n\\n" : "") + "Whiteboard edits to diagram " + (index + 1) + (diagramId ? " (" + diagramId + ")" : "") + ":\\n" + (summary || "(no summary)") + "\\n\\nEdited scene JSON: " + String(files.scene_path || "") + (files.preview_path ? "\\nPNG preview: " + String(files.preview_path) : "")
      enqueue({
        selector: "", tag: "whiteboard", text: "Whiteboard: diagram " + (index + 1), prompt: promptText, queueKey: "whiteboard:" + index,
        target: { type: "excalidraw-scene", diagramIndex: index, diagramId, sourceHash: String(message.sourceHash || ""), scenePath: String(files.scene_path || ""), previewPath: String(files.preview_path || ""), imageFallback: !!message.imageFallback, stats: message.stats && typeof message.stats === "object" ? message.stats : {} },
      })
      postWb(index, mode, { type: "redcode-whiteboard:queueResult", ok: true })
      if (mode === "overlay") closeWhiteboard()
    } catch (error) {
      postWb(index, mode, { type: "redcode-whiteboard:queueResult", ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  // Inline frames go with the document on a reload and start over against fresh sources. Only an
  // open overlay outlives it: tell it when its diagram changed underneath, never merge silently.
  const refreshWhiteboardSource = async () => {
    if (overlayIndex === null) return
    const index = overlayIndex
    try {
      const sources = await fetchSources()
      const source = sources.find((item) => item.index === index)
      const nextHash = source ? String(source.hash || "") : ""
      const record = wbRecord(index)
      if (nextHash === record.sourceHash) return
      record.source = source ? String(source.source || "") : ""
      record.sourceHash = nextHash
      postOverlay({ type: "redcode-whiteboard:sourceChanged", source: record.source, sourceHash: record.sourceHash })
    } catch {}
  }
  const validIndex = (value) => { const index = Number(value); return Number.isInteger(index) && index >= 0 && index <= 999 ? index : null }
  const handleAuthenticated = (index, message, mode) => {
    if (message.type === "redcode-whiteboard:save") handleSave(index, message, mode)
    if (message.type === "redcode-whiteboard:queueFeedback") queueWhiteboard(index, message, mode)
    if (message.type === "redcode-whiteboard:maximize" && mode === "inline") openOverlay(index)
    if (message.type === "redcode-whiteboard:close" && mode === "overlay") closeWhiteboard()
    if (message.type === "redcode-whiteboard:teardownReady") settleTeardown(index, message, mode, true)
    if (message.type === "redcode-whiteboard:teardownFailed") settleTeardown(index, message, mode, false)
    if (message.type === "redcode-whiteboard:flushComplete") finishFlush(index, message, mode)
  }
  // A genuine inline frame is a direct child of the current prototype window. Descent, not the
  // token, is what proves the sender is ours: the frame page is framable by anyone.
  const isPrototypeChild = (source) => { try { return !!source && source.parent === frame.contentWindow } catch { return false } }
  const handleInline = (event, message) => {
    if (ended || !isPrototypeChild(event.source)) return
    const index = validIndex(message.diagramIndex)
    if (index === null) return
    if (message.type === "redcode-whiteboard:ready") {
      if (inlineChannels.has(index)) return
      const channelId = String(message.channelToken || "")
      if (!channelId) return
      authenticate(channelId).then((ok) => {
        if (!ok || ended || inlineChannels.has(index)) return
        const channel = { window: event.source, channelId, initialized: false }
        inlineChannels.set(index, channel)
        wbRecord(index).diagramId = String(message.diagramId || "")
        wbReady(index, "inline", () => inlineChannels.get(index) === channel).then((initialized) => { if (inlineChannels.get(index) === channel) channel.initialized = initialized })
      })
      return
    }
    const channel = inlineChannels.get(index)
    if (!channel || channel.window !== event.source || channel.channelId !== message.channelId) return
    handleAuthenticated(index, message, "inline")
  }
  const handleOverlay = (event, message) => {
    if (overlayIndex === null) return
    const index = validIndex(message.diagramIndex)
    if (index === null || index !== overlayIndex) return
    if (message.type === "redcode-whiteboard:ready") {
      if (overlayReady || overlayChannel) return
      const channelId = String(message.channelToken || "")
      if (!channelId) return
      overlayChannel = channelId
      authenticate(channelId).then(async (ok) => {
        const isCurrent = () => overlayIndex === index && overlayChannel === channelId && event.source === wbFrame.contentWindow
        if (!ok) { if (isCurrent()) overlayChannel = ""; return }
        if (!isCurrent()) return
        const initialized = await wbReady(index, "overlay", isCurrent)
        if (initialized && isCurrent()) overlayReady = true
      })
      return
    }
    if (!overlayReady || message.channelId !== overlayChannel) return
    handleAuthenticated(index, message, "overlay")
  }
  window.addEventListener("message", (event) => {
    const message = event.data
    if (!message || typeof message !== "object" || typeof message.type !== "string" || !message.type.startsWith("redcode-whiteboard:")) return
    if (event.source === wbFrame.contentWindow) handleOverlay(event, message)
    else if (event.source !== frame.contentWindow) handleInline(event, message)
  })
  wbClose.addEventListener("click", closeWhiteboard)

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
    on("reload", async (data) => {
      if (typeof data.revision !== "number" || data.revision === revision) return
      revision = data.revision
      // Open whiteboards get a moment to save before the document that holds them is replaced.
      await flushWhiteboards()
      loadFrame()
      refreshWhiteboardSource()
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
    on("layout-warnings", (data) => { if (Array.isArray(data.warnings)) setWarnings(data.warnings) })
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
  composerImages.reset()
  draw()
  applySheet()
  if (ended) markEnded(ended)
})()
</script>
</body>
</html>`
}

export * as DesignShell from "./shell"

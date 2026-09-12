import type { Design } from "@reddb-io/redcode-schema/design"
import type { ReviewCopy } from "./copy"

export interface ReviewOptions {
  base: string
  endpoint?: string
  sessionID: string
  copy: ReviewCopy
  appearance?: { css: string; favicon: string }
  request?: (url: string, init?: RequestInit) => Promise<Response>
  /** Follows the server's conversation feed; absent when the host renders the conversation itself. */
  feed?: (
    url: string,
    request: (url: string, init?: RequestInit) => Promise<Response>,
    signal: AbortSignal,
    onEvent: (event: Design.FeedEvent) => void,
    onUnavailable: () => void,
  ) => void
}

/** Shared native review surface. The standalone host serializes this self-contained function. */
export function mountReview(host: HTMLElement, options: ReviewOptions) {
  const copy = { ...options.copy }
  const transport = options.request ?? fetch
  const request = (url: string, init?: RequestInit) =>
    transport(url, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) })
  const root = host.attachShadow({ mode: "open" })
  host.dataset.theme = "application"
  host.dataset.density = "compact"
  const scheme = matchMedia("(prefers-color-scheme: dark)")
  const syncScheme = () => {
    const inherited = getComputedStyle(host.parentElement ?? document.documentElement).colorScheme
    host.dataset.colorScheme = inherited === "dark" || (inherited !== "light" && scheme.matches) ? "dark" : "light"
  }
  syncScheme()
  scheme.addEventListener("change", syncScheme)
  const schemeObserver = new MutationObserver(syncScheme)
  schemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-color-scheme", "data-theme"],
  })
  const endpoint =
    options.endpoint ?? `${options.base.replace(/\/$/, "")}/api/session/${encodeURIComponent(options.sessionID)}/design`
  const state = {
    creating: false,
    design: undefined as Design.Info | undefined,
    revision: "",
    failedPreview: "",
    revisionInfo: undefined as Design.Revision | undefined,
    audits: [] as Design.Job[],
    notes: [] as Design.Feedback["items"][number][],
    params: {} as Design.ParamValues,
    component: "",
    preset: "",
    assets: [] as string[],
    snapshot: "",
    selection: { tag: "", elementText: "", selectedText: "" },
    pending: undefined as Design.Feedback | undefined,
    boards: [] as { target: string; scene: unknown }[],
    board: undefined as
      | { scene: unknown; source_hash: string; baseline: unknown; text_metrics_version: number }
      | undefined,
    channel: "",
    stopped: false,
    loading: false,
    working: false,
    html: "",
    variants: [] as { id: string; name: string }[],
    variant: "",
    peer: "",
    comparing: false,
    variantPending: undefined as Design.Feedback | undefined,
    approving: undefined as Design.Approve | undefined,
    approval: undefined as Design.Approval | undefined,
    feed: [] as Design.FeedEvent[],
    scroll: { x: 0, y: 0 },
    peerScroll: { x: 0, y: 0 },
    restoreScroll: false,
  }
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
  const thumbnails = new Map<string, string>()
  const controller = new AbortController()
  const api = async <T>(route = "", method = "GET", body?: unknown): Promise<T> => {
    const response = await request(endpoint + route, {
      method,
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => undefined)
      throw new Error(typeof body?.message === "string" ? body.message : `${copy.failure} (${response.status})`)
    }
    return response.json()
  }
  const element = <T extends HTMLElement>(id: string) => root.getElementById(id) as T
  const input = (id: string) => element<HTMLInputElement>(id)
  const key = () => `redcode:design:${endpoint}:${state.design?.id}:${state.revision}`
  const status = (text: string, key?: keyof ReviewCopy, tone = "info") => {
    element("status").textContent = text
    element("status").dataset.tone = tone
    root.querySelectorAll("dialog[open] [data-action-status]").forEach((node) => {
      node.textContent = text
    })
    if (key) element("status").dataset.copy = key
    else delete element("status").dataset.copy
  }
  const text = (id: string, value: string, fallback: keyof ReviewCopy = "none") => {
    element(id).textContent = value || copy[fallback]
    if (value) delete element(id).dataset.copy
    else element(id).dataset.copy = fallback
  }
  const tasks = { tail: Promise.resolve() }
  const run = (task: () => Promise<void>, trigger?: HTMLElement, quiet = false) => {
    if (!quiet && state.working) return Promise.resolve()
    if (!quiet) {
      state.working = true
      trigger?.setAttribute("aria-busy", "true")
      status(copy.busy, "busy")
      controls()
    }
    const pending = tasks.tail.then(async () => {
      if (state.stopped) return
      state.loading = true
      try {
        await task()
        if (!quiet && element("status").dataset.copy === "busy") status(copy.done, "done", "success")
      } catch (error) {
        if (!state.stopped) status(error instanceof Error ? error.message : copy.failure, undefined, "error")
      } finally {
        state.loading = false
        if (!quiet) {
          state.working = false
          trigger?.removeAttribute("aria-busy")
          if (!state.stopped) controls()
        }
      }
    })
    tasks.tail = pending
    return pending
  }
  root.innerHTML = `<style>${options.appearance?.css ?? ""}</style><style>
:host{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color-scheme:light dark;--surface:var(--reddb-color-background);--panel:var(--reddb-color-elevation-raised-surface);--canvas:var(--reddb-color-elevation-sunken-surface);--ink:var(--reddb-color-foreground);--muted:var(--reddb-color-ink-muted);--edge:var(--reddb-color-elevation-base-border);--accent:var(--reddb-color-primary);--accent-ink:var(--reddb-color-on-primary);background:var(--surface);color:var(--ink);font:13px/1.5 var(--reddb-font-family-sans,system-ui)}
*{box-sizing:border-box}[hidden]{display:none!important}button,input,select,textarea{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);padding:var(--reddb-spatial-gap-md) var(--reddb-spatial-inset-sm);min-height:var(--reddb-spatial-control-height-md);min-width:0}button{cursor:pointer;line-height:18px;transition:background-color var(--reddb-duration-fast) ease,border-color var(--reddb-duration-fast) ease}button:hover{background:var(--panel);border-color:var(--muted)}button:active{background:var(--canvas)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled{opacity:.45;cursor:default}.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}.primary:hover{background:color-mix(in oklch,var(--accent) 88%,var(--ink));border-color:var(--accent)}
header{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--edge);flex:none;min-width:0}h1{font-size:14px;letter-spacing:-.02em;margin:0 18px 0 0;display:flex;align-items:center;gap:8px}h1 img{width:20px;height:20px;display:block}h2{font-size:15px;letter-spacing:-.015em;margin:0 0 12px}header select{width:auto;max-width:280px;flex:0 1 240px}header #new{margin-left:auto}header #refresh{background:transparent}#studio>header{padding:8px 16px;background:var(--panel)}#studio>header #revisions{margin-right:auto}#width{flex:0 0 auto;width:auto;max-width:120px}#restore{border-color:transparent;background:transparent;color:var(--muted)}#approve,#reopen{white-space:nowrap}
#studio{flex:1;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr)}main{min-height:0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 336px;overflow:hidden}.canvas{background:var(--canvas);overflow:auto;min-height:0;min-width:0;padding:24px}iframe{display:block;background:oklch(99% .002 220);border:0;height:100%;min-height:0;width:100%;margin:0 auto;box-shadow:0 0 0 1px var(--edge),0 6px 24px color-mix(in oklch,var(--ink) 7%,transparent)}aside{min-height:0;min-width:0;border-left:1px solid var(--edge);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}.tabs{display:flex;padding:0 16px;border-bottom:1px solid var(--edge);gap:18px}.tabs button{border:0;border-radius:0;background:none;padding:13px 0;color:var(--muted);position:relative}.tabs button[aria-selected=true]{color:var(--ink);font-weight:600}.tabs button[aria-selected=true]::after{content:"";position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--accent)}.panel{overflow:auto;min-height:0;padding:20px}.panel>p{margin:0 0 16px}.section{margin-top:24px;padding-top:18px;border-top:1px solid var(--edge)}label{display:grid;gap:6px;margin-bottom:14px;font-size:12px;font-weight:500}label input,label select,label textarea{font-size:13px;font-weight:400}textarea{min-height:96px;resize:vertical;width:100%;line-height:1.55}input:not([type=checkbox]),select{max-width:100%;width:100%}input[type=checkbox]{accent-color:var(--accent);margin:0}label.check{display:flex;align-items:center;gap:8px;font-weight:400}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1;min-width:0}#note{min-height:116px}#send{width:100%;margin:14px 0 8px}#add{margin-bottom:14px}#attachment{font-size:11px;padding:6px;width:100%}#attachment::file-selector-button{font:inherit;border:0;border-radius:3px;padding:4px 7px;margin-right:8px;background:var(--panel);color:var(--ink);cursor:pointer}
details{border-top:1px solid var(--edge);padding:14px 0}summary{cursor:pointer;font-weight:600;list-style-position:inside;color:var(--ink);margin-bottom:0}details[open]>summary{margin-bottom:14px}details:last-child{padding-bottom:0}.note{padding:10px 0;border-bottom:1px solid var(--edge);overflow-wrap:anywhere}.note button{float:right;padding:2px 7px;font-size:11px}.muted,small{font-size:12px;color:var(--muted);font-weight:400}small{display:block}#draft{margin-bottom:12px}#target{overflow-wrap:anywhere;background:var(--panel);font:11px/1.5 ui-monospace,monospace;padding:7px 9px;border-radius:4px;margin:12px 0}#target:empty{display:none}#notes:empty{display:none}#notes{margin-bottom:16px}#status{flex:none;min-height:28px;padding:5px 16px;border-top:1px solid var(--edge);font-size:11px;color:var(--muted)}#status:empty{display:none}#newer{color:var(--accent)}.asset{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--edge)}.asset img{width:48px;height:48px;object-fit:contain;background:var(--panel);border-radius:4px}#jobs .note{display:grid;gap:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#source-files{font-size:12px;overflow-wrap:anywhere}#html,#audit,#compare,#gif{margin-bottom:12px}#intake{flex:1;overflow:auto}form.intake{max-width:600px;margin:32px auto;padding:24px}form.intake h2{font-size:24px;margin-bottom:24px}#board-dialog{padding:12px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}#board-dialog::backdrop{background:color-mix(in oklch,var(--canvas) 70%,transparent)}#board-close{margin-bottom:12px}#board-frame{box-shadow:none}.canvas:has(iframe[src="about:blank"])::before{content:attr(data-empty);display:block;color:var(--muted);text-align:center;padding:24px}
@container(max-width:900px){header{gap:6px;padding:8px 12px}h1{margin-right:8px}header select{flex-basis:160px;max-width:200px}#restore{font-size:0;width:32px;height:32px;flex:none;padding:0}#restore::before{content:"↶";font-size:20px}main{grid-template-columns:minmax(0,1fr) 300px}.canvas{padding:16px}.panel{padding:16px}}
@container(max-width:640px){:host{min-height:0}header{flex-wrap:wrap}header h1{font-size:13px}header #designs{flex:1;max-width:none}header #new{margin-left:0}#studio>header{flex-wrap:wrap}#studio>header #revisions{flex:1;max-width:none}#width{max-width:100px}#approve,#reopen{font-size:12px}main{display:grid;grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(220px,.85fr)}.canvas{padding:12px}aside{border-left:0;border-top:1px solid var(--edge)}.tabs{gap:24px}.tabs button{padding:10px 0}.panel{padding:16px}form.intake{margin:0;padding:20px}}
.variant-bar{display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid var(--edge);min-width:0;flex-wrap:wrap}.variant-bar .tabs{border:0;padding:0;flex:1;overflow:auto;gap:16px}.variant-bar .tabs button{white-space:nowrap}.variant-bar>button{margin:6px 0;white-space:nowrap}.variant-bar>button[aria-pressed=true]{background:var(--panel);border-color:var(--accent);color:var(--accent)}.variant-bar #add-variant{margin-right:auto}.canvas{display:flex;gap:20px;padding:16px}.preview-pane{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%}.viewport{flex:1;min-height:0;overflow:auto;padding:1px}.viewport iframe{height:100%;min-height:150px}.pane-label{height:38px;flex:none;font-size:12px;display:flex;align-items:center;gap:8px;margin:0;padding-bottom:6px}.pane-label select{width:auto;flex:1;padding:4px 8px}.canvas[data-comparing=true] .preview-pane{min-width:280px}.action-dialog{width:min(520px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:24px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}.action-dialog::backdrop{background:#0008}.action-dialog p{overflow-wrap:anywhere}.action-dialog .row{justify-content:flex-end}.action-dialog .row>*{flex:0 1 auto}#status{font-size:13px;min-height:38px;padding:9px 16px;background:var(--panel);border-bottom:1px solid var(--edge);border-top:0;color:var(--ink)}#status[data-tone=error]{color:var(--reddb-color-feedback-danger-foreground)}#status[data-tone=success]{color:var(--reddb-color-feedback-success-foreground)}button[aria-busy=true]{opacity:1;cursor:progress}button[aria-busy=true]::before{content:"";display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.preview-pane[aria-busy=true] .viewport{opacity:.5}#width{max-width:180px}@container(max-width:640px){.variant-bar{padding:0 12px;gap:6px}.variant-bar .tabs{flex-basis:100%}.canvas{padding:12px;gap:12px}.variant-bar>button{font-size:12px}#width{max-width:165px}}
@media(prefers-reduced-motion:reduce){button{transition:none}button[aria-busy=true]::before{animation:none}}
#agent-state{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid var(--edge);color:var(--muted);white-space:nowrap}#agent-state[data-state=working]{color:var(--accent);border-color:var(--accent)}#agent-state[data-state=working]::before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-1px;animation:spin .8s linear infinite}#agent-state[data-state=published]{color:var(--reddb-color-feedback-success-foreground);border-color:currentColor}#feed{display:grid;gap:8px;margin-bottom:16px;max-height:40vh;overflow:auto}#feed:not(:has(.entry)) #feed-empty{display:block}#feed-empty{margin:0}#feed:has(.entry) #feed-empty{display:none}.entry{padding:8px 10px;border-radius:var(--reddb-radius-md);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5}.entry[data-kind=user]{background:color-mix(in oklch,var(--accent) 10%,var(--panel))}.entry[data-kind=tool]{font:11px/1.5 ui-monospace,monospace;color:var(--muted);padding:4px 10px;background:transparent}.entry[data-kind=published]{color:var(--reddb-color-feedback-success-foreground);font-weight:600}
    </style><header><h1>${options.appearance ? `<img src="${options.appearance.favicon}" alt="RedDB">` : ""}<span data-copy="title">${copy.title}</span></h1><select id="designs" aria-label="${copy.alternatives}" data-copy-aria-label="alternatives"></select><button id="new"><span data-copy="create">${copy.create}</span></button><button id="refresh"><span data-copy="refresh">${copy.refresh}</span></button></header>
    <section id="intake"><form class="intake" id="create"><h2><span data-copy="create">${copy.create}</span></h2><label><span data-copy="name">${copy.name}</span><input id="name" required></label><div class="row"><label><span data-copy="journey">${copy.journey}</span><select id="journey"><option value="new" data-copy="new">${copy.new}</option><option value="existing" data-copy="existing">${copy.existing}</option></select></label><label><span data-copy="engine">${copy.engine}</span><select id="engine"><option value="html">HTML</option><option value="react">React</option><option value="solid">Solid</option></select></label></div><label><span data-copy="application">${copy.application}</span><input id="application" value="."></label><label><span data-copy="objective">${copy.objective}</span><textarea id="objective" required></textarea></label><label><span data-copy="audience">${copy.audience}</span><input id="audience"></label><label><span data-copy="constraints">${copy.constraints}</span><textarea id="constraints"></textarea></label><label><span data-copy="references">${copy.references}</span><textarea id="references"></textarea></label><button class="primary"><span data-copy="create">${copy.create}</span></button></form></section>
    <section id="studio" hidden><header><select id="revisions" aria-label="${copy.history}" data-copy-aria-label="history"></select><button id="newer" hidden><span data-copy="latest">${copy.latest}</span></button><span id="agent-state" hidden data-state="idle" data-copy="stateIdle">${copy.stateIdle}</span><select id="width" aria-label="${copy.width}" data-copy-aria-label="width"><option value="100%" data-copy="full">${copy.full}</option><option value="390" data-copy="mobile">${copy.mobile}</option><option value="768" data-copy="tablet">${copy.tablet}</option><option value="1440" data-copy="desktop">${copy.desktop}</option></select><button id="restore" title="${copy.restore}" data-copy-title="restore" aria-label="${copy.restore}" data-copy-aria-label="restore"><span data-copy="restore">${copy.restore}</span></button><button id="approve" class="primary"><span data-copy="approve">${copy.approve}</span></button><button id="reopen" hidden><span data-copy="reopen">${copy.reopen}</span></button></header><div class="variant-bar"><div id="variants" class="tabs" role="tablist" aria-label="${copy.variants}" data-copy-aria-label="variants"></div><span id="no-variants" class="muted" data-copy="noVariants">${copy.noVariants}</span><button id="organize-variants" data-copy="organizeVariants">${copy.organizeVariants}</button><button id="add-variant" data-copy="addVariant">${copy.addVariant}</button><button id="view-single" aria-pressed="true" data-copy="single">${copy.single}</button><button id="view-compare" aria-pressed="false" data-copy="sideBySide">${copy.sideBySide}</button></div><main><div class="canvas" id="canvas"><p id="preview-error" role="alert" hidden style="white-space:pre-wrap;overflow-wrap:anywhere"></p><section class="preview-pane" id="primary-pane" role="tabpanel"><div class="pane-label" id="primary-label" hidden></div><div class="viewport"><iframe id="preview" title="${copy.review}" data-copy-title="review" sandbox="allow-scripts allow-forms" allow=""></iframe></div></section><section class="preview-pane" id="peer-pane" hidden><label class="pane-label"><span data-copy="compareVariant">${copy.compareVariant}</span><select id="peer-variant"></select></label><div class="viewport"><iframe id="peer-preview" title="${copy.compareVariant}" data-copy-title="compareVariant" sandbox="allow-scripts allow-forms" allow=""></iframe></div></section></div><aside><div class="tabs" role="tablist" aria-label="${copy.review}"><button type="button" role="tab" id="tab-review" aria-controls="panel-review" aria-selected="true" tabindex="0"><span data-copy="conversation">${copy.conversation}</span></button><button type="button" role="tab" id="tab-assets" aria-controls="panel-assets" aria-selected="false" tabindex="-1"><span data-copy="assets">${copy.assets}</span></button><button type="button" role="tab" id="tab-details" aria-controls="panel-details" aria-selected="false" tabindex="-1"><span data-copy="details">${copy.details}</span></button><button type="button" role="tab" id="tab-params" aria-controls="panel-params" aria-selected="false" tabindex="-1"><span data-copy="params">${copy.params}</span></button></div><section class="panel" role="tabpanel" id="panel-review" aria-labelledby="tab-review"><h2><span data-copy="conversation">${copy.conversation}</span></h2><p id="review-state" class="muted"></p><div id="feed" role="log" aria-live="polite" hidden><p id="feed-empty" class="muted" data-copy="feedEmpty">${copy.feedEmpty}</p></div><details id="approved-record" hidden><summary data-copy="approvalDetails">${copy.approvalDetails}</summary><pre id="approved-details"></pre></details><label class="check"><input id="annotate" type="checkbox"><span data-copy="annotate">${copy.annotate}</span></label><p class="muted"><span data-copy="inspect">${copy.inspect}</span></p><small id="target"></small><label><span data-copy="notes">${copy.notes}</span><textarea id="note"></textarea></label><button id="add"><span data-copy="add">${copy.add}</span></button><div id="notes"></div><label><span data-copy="attachment">${copy.attachment}</span><input id="attachment" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"></label><small id="draft"><span data-copy="draft">${copy.draft}</span></small><label class="check"><input type="checkbox" id="queue"><span data-copy="queue">${copy.queue}</span></label><label class="check"><input type="checkbox" id="end"><span data-copy="end">${copy.end}</span></label><button id="send" class="primary"><span data-copy="send">${copy.send}</span></button>
    <details><summary><span data-copy="diagram">${copy.diagram}</span></summary><label><span data-copy="diagram">${copy.diagram}</span><textarea id="selection"></textarea></label><button type="button" id="whiteboard"><span data-copy="whiteboard">${copy.whiteboard}</span></button></details></section><section class="panel" role="tabpanel" id="panel-assets" aria-labelledby="tab-assets" hidden><details open><summary><span data-copy="assets">${copy.assets}</span></summary><div id="assets"></div></details><details open><summary><span data-copy="export">${copy.export}</span></summary><button id="html"><span data-copy="html">${copy.html}</span></button><button id="audit"><span data-copy="audit">${copy.audit}</span></button><label><span data-copy="implementation">${copy.implementation}</span><input id="implementation" value="dist"></label><button id="compare"><span data-copy="compare">${copy.compare}</span></button><label><span data-copy="source">${copy.source}</span><select id="svg"></select></label><div class="row"><label><span data-copy="duration">${copy.duration}</span><input id="duration" type="number" min="0.1" max="10" step="0.1" value="3"></label><label><span data-copy="fps">${copy.fps}</span><input id="fps" type="number" min="1" max="25" value="20"></label></div><label><span data-copy="size">${copy.size}</span><input id="size" type="number" min="16" max="1024" value="512"></label><label class="check"><input type="checkbox" id="transparent"><span data-copy="transparent">${copy.transparent}</span></label><button id="gif"><span data-copy="gif">${copy.gif}</span></button></details><details open><summary><span data-copy="jobs">${copy.jobs}</span></summary><div id="jobs"></div></details>
    </section><section class="panel" role="tabpanel" id="panel-details" aria-labelledby="tab-details" hidden>
    <details><summary><span data-copy="findings">${copy.findings}</span></summary><div id="findings"></div></details><details><summary><span data-copy="system">${copy.system}</span></summary><div id="source-files"></div><button id="refresh-system"><span data-copy="refreshSystem">${copy.refreshSystem}</span></button></details><details><summary><span data-copy="decisions">${copy.decisions}</span></summary><div id="decisions"></div><h2><span data-copy="questions">${copy.questions}</span></h2><div id="questions"></div><h2><span data-copy="scenarios">${copy.scenarios}</span></h2><div id="scenarios"></div></details>
    <details><summary><span data-copy="tweaks">${copy.tweaks}</span></summary><label><span data-copy="token">${copy.token}</span><input id="token" value="--accent"></label><label><span data-copy="value">${copy.value}</span><input id="value" value="#285b49"></label><button id="apply"><span data-copy="apply">${copy.apply}</span></button><button id="reset"><span data-copy="reset">${copy.reset}</span></button></details>
    </section><section class="panel" role="tabpanel" id="panel-params" aria-labelledby="tab-params" hidden>
    <p id="params-empty" class="muted" data-copy="paramEmpty">${copy.paramEmpty}</p>
    <div id="params-controls" hidden>
    <label><span data-copy="paramScenario">${copy.paramScenario}</span><select id="param-preset" aria-label="${copy.paramScenario}" data-copy-aria-label="paramScenario"></select></label>
    <button type="button" id="param-reset" data-copy="paramReset">${copy.paramReset}</button>
    <div class="section"><label class="check"><input type="checkbox" id="param-select"><span data-copy="paramSelect">${copy.paramSelect}</span></label>
    <label><span data-copy="paramComponent">${copy.paramComponent}</span><select id="param-component" aria-label="${copy.paramComponent}" data-copy-aria-label="paramComponent"></select></label>
    <div id="param-fields"></div></div>
    <div class="section"><label><span data-copy="paramName">${copy.paramName}</span><input id="param-name" required maxlength="100"></label>
    <button type="button" id="param-save" data-copy="paramSave">${copy.paramSave}</button>
    <p class="muted" data-copy="paramPublish">${copy.paramPublish}</p></div></div></section></aside></main></section><dialog id="board-dialog" style="width:95vw;height:90vh;max-width:1400px"><button id="board-close"><span data-copy="close">${copy.close}</span></button><iframe id="board-frame" title="${copy.whiteboard}" data-copy-title="whiteboard" sandbox="allow-scripts" style="height:calc(100% - 50px);width:100%"></iframe></dialog><dialog id="approve-dialog" class="action-dialog" aria-labelledby="approve-heading"><h2 id="approve-heading" data-copy="confirm">${copy.confirm}</h2><p id="approval-revision"></p><p data-copy="approvalScope">${copy.approvalScope}</p><div class="row"><button id="cancel-approve" data-copy="cancel">${copy.cancel}</button><button id="confirm-approve" class="primary" data-copy="approveAction">${copy.approveAction}</button></div></dialog><dialog id="variant-dialog" class="action-dialog" aria-labelledby="variant-heading"><form id="variant-form"><h2 id="variant-heading" data-copy="addVariant">${copy.addVariant}</h2><p data-copy="variantHint">${copy.variantHint}</p><label><span data-copy="variantPrompt">${copy.variantPrompt}</span><textarea id="variant-prompt" required></textarea></label><div class="row"><button type="button" id="cancel-variant" data-copy="cancel">${copy.cancel}</button><button type="submit" id="request-variant" class="primary" data-copy="requestVariant">${copy.requestVariant}</button></div></form></dialog><div id="status" role="status" aria-live="polite"></div>`

  for (const id of ["approve-dialog", "variant-dialog"]) {
    const notice = document.createElement("p")
    notice.dataset.actionStatus = ""
    notice.setAttribute("role", "status")
    notice.setAttribute("aria-live", "polite")
    element(id).append(notice)
  }
  const controls = () => {
    root
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("button, input, select, textarea")
      .forEach((control) => {
        if (control.id.startsWith("tab-") || control.id.startsWith("cancel-") || control.id === "board-close") return
        control.disabled = state.working
      })
    for (const id of [
      "approve",
      "restore",
      "send",
      "add-variant",
      "organize-variants",
      "request-variant",
      "apply",
      "reset",
      "html",
      "audit",
      "gif",
      "compare",
    ])
      element<HTMLButtonElement>(id).disabled ||=
        !state.revision ||
        !!state.failedPreview ||
        (!!state.design?.ended && !["html", "audit", "gif", "compare"].includes(id))
    element<HTMLButtonElement>("param-save").disabled ||=
      !state.revision || !!state.failedPreview || state.revision !== state.design?.revision || !!state.design?.ended
    element<HTMLButtonElement>("approve").disabled ||= state.revision !== state.design?.revision
    element<HTMLButtonElement>("confirm-approve").disabled ||=
      !state.revision || !!state.failedPreview || state.revision !== state.design?.revision || !!state.design?.ended
    element<HTMLButtonElement>("send").disabled =
      state.working || !state.revision || !!state.failedPreview || (!!state.design?.ended && !state.pending)
    input("note").disabled ||= !!state.pending
    input("variant-prompt").disabled ||= !!state.variantPending
    for (const id of ["add", "attachment", "queue", "end"])
      input(id).disabled ||= !!state.pending || !!state.design?.ended
    for (const id of ["view-single", "view-compare", "peer-variant"])
      input(id).disabled ||= !!state.failedPreview || state.variants.length < 2
    element("variants")
      .querySelectorAll("button")
      .forEach((button) => {
        button.disabled ||= !!state.failedPreview
      })
  }
  const selectVariant = (id: string) => {
    if (state.working || state.failedPreview) return
    state.variant = id
    element("target").textContent = ""
    input("selection").value = ""
    state.snapshot = ""
    state.selection = { tag: "", elementText: "", selectedText: "" }
    drawVariants()
    state.preset = ""
    drawParams()
    element(`variant-${id}`).focus()
  }
  const drawVariants = () => {
    const items = state.variants
    element("no-variants").hidden = items.length > 0
    element("organize-variants").hidden = items.length > 0
    element("variants").replaceChildren(
      ...items.map((item, index) => {
        const button = document.createElement("button")
        button.id = `variant-${item.id}`
        button.textContent = item.name
        button.setAttribute("role", "tab")
        button.setAttribute("aria-controls", "primary-pane")
        button.setAttribute("aria-selected", String(item.id === state.variant))
        button.tabIndex = item.id === state.variant ? 0 : -1
        button.onclick = () => selectVariant(item.id)
        button.onkeydown = (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length
          selectVariant(items[next].id)
          element(`variant-${items[next].id}`).focus()
        }
        return button
      }),
    )
    if (state.variant) element("primary-pane").setAttribute("aria-labelledby", `variant-${state.variant}`)
    else element("primary-pane").removeAttribute("aria-labelledby")
    if (!items.some((item) => item.id === state.peer && item.id !== state.variant))
      state.peer = items.find((item) => item.id !== state.variant)?.id ?? ""
    element("peer-variant").replaceChildren(
      ...items
        .filter((item) => item.id !== state.variant)
        .map((item) => {
          const option = document.createElement("option")
          option.value = item.id
          option.textContent = item.name
          return option
        }),
    )
    input("peer-variant").value = state.peer
    state.comparing &&= items.length > 1
    element("peer-pane").hidden = !!state.failedPreview || !state.comparing
    element("primary-label").hidden = !state.comparing
    element("primary-label").textContent = items.find((item) => item.id === state.variant)?.name ?? ""
    element("canvas").dataset.comparing = String(state.comparing)
    element("view-single").setAttribute("aria-pressed", String(!state.comparing))
    element("view-compare").setAttribute("aria-pressed", String(state.comparing))
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage({ type: "design:variant", id: state.variant }, "*")
    const peer = element<HTMLIFrameElement>("peer-preview")
    if (state.comparing && peer.srcdoc !== state.html) peer.srcdoc = state.html
    if (!state.comparing) peer.removeAttribute("srcdoc")
    if (state.comparing) peer.contentWindow?.postMessage({ type: "design:variant", id: state.peer }, "*")
    controls()
  }
  const tabs = ["review", "assets", "details", "params"] as const
  const selectTab = (name: (typeof tabs)[number]) => {
    input("param-select").checked = false
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:params-select", enabled: false },
      "*",
    )
    for (const tab of tabs) {
      const selected = tab === name
      element(`tab-${tab}`).setAttribute("aria-selected", String(selected))
      element(`tab-${tab}`).tabIndex = selected ? 0 : -1
      element(`panel-${tab}`).hidden = !selected
    }
  }
  for (const name of tabs) {
    element(`tab-${name}`).onclick = () => selectTab(name)
    element(`tab-${name}`).onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (tabs.indexOf(name) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
      selectTab(tabs[index])
      element(`tab-${tabs[index]}`).focus()
    }
  }

  const paramContext = (): Design.ParamContext => ({
    values: structuredClone(state.params),
    ...(state.preset ? { preset: state.preset } : {}),
    ...(state.component ? { component: state.component } : {}),
    ...(state.variant ? { variant: state.variant } : {}),
  })
  const sendParams = (values: Design.ParamValues, reset = false) => {
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage({ type: "design:params-set", values, reset }, "*")
  }
  const paramComponents = () =>
    (state.revisionInfo?.document.controls ?? []).filter((item) => !item.variant || item.variant === state.variant)
  const drawParams = () => {
    const components = paramComponents()
    if (!components.some((item) => item.id === state.component)) state.component = components[0]?.id ?? ""
    element("params-empty").hidden = !!components.length
    element("params-controls").hidden = !components.length
    element("param-component").replaceChildren(...components.map((item) => new Option(item.name, item.id)))
    input("param-component").value = state.component
    const component = components.find((item) => item.id === state.component)
    element("param-fields").replaceChildren(
      ...(component?.fields ?? []).map((field) => {
        const label = document.createElement("label")
        label.textContent = field.name
        const control = field.type === "select" ? document.createElement("select") : document.createElement("input")
        control.id = `param-field-${field.id}`
        control.setAttribute("aria-label", field.name)
        if (control instanceof HTMLSelectElement && field.type === "select")
          control.replaceChildren(...field.options.map((item) => new Option(item, item)))
        if (control instanceof HTMLInputElement) {
          control.type = field.type === "boolean" ? "checkbox" : field.type === "number" ? "number" : "text"
          if (field.type === "number") {
            control.step = "any"
            if (field.min !== undefined) control.min = String(field.min)
            if (field.max !== undefined) control.max = String(field.max)
          }
          if (field.type === "text") control.maxLength = 4000
        }
        control.onchange = () => {
          if (!control.reportValidity()) return
          const value =
            field.type === "boolean" && control instanceof HTMLInputElement
              ? control.checked
              : field.type === "number"
                ? Number(control.value)
                : control.value
          state.preset = ""
          input("param-preset").value = ""
          sendParams({ [state.component]: { [field.id]: value } })
        }
        label.append(control)
        if (field.type === "boolean") label.className = "check"
        return label
      }),
    )
    const presets = (state.revisionInfo?.document.presets ?? []).filter(
      (item) => !item.variant || item.variant === state.variant,
    )
    element("param-preset").replaceChildren(
      new Option(copy.paramCustom, ""),
      ...presets.map((item) => new Option(item.name, item.id)),
    )
    input("param-preset").value = state.preset
    element<HTMLButtonElement>("param-save").disabled =
      state.working || !state.revision || state.design?.revision !== state.revision || !!state.design?.ended
    syncParams()
  }
  const syncParams = () => {
    const component = paramComponents().find((item) => item.id === state.component)
    for (const field of component?.fields ?? []) {
      const control = input(`param-field-${field.id}`)
      if (!control) continue
      // A field being edited keeps the typed value; the prototype's state message must not clobber
      // it before `change` fires, or the edit is silently lost.
      if (control.matches(":focus")) continue
      const value = state.params[state.component]?.[field.id] ?? field.default
      if (field.type === "boolean") control.checked = value === true
      else control.value = String(value)
    }
  }
  input("param-component").onchange = () => {
    state.component = input("param-component").value
    drawParams()
    save()
  }
  input("param-select").onchange = () => {
    input("annotate").checked = false
    element("annotate").dispatchEvent(new Event("change"))
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:params-select", enabled: input("param-select").checked },
      "*",
    )
  }
  input("param-preset").onchange = () => {
    state.preset = input("param-preset").value
    const preset = state.revisionInfo?.document.presets?.find((item) => item.id === state.preset)
    if (preset) sendParams(preset.values, true)
    save()
  }
  element("param-reset").onclick = () => {
    const preset = state.revisionInfo?.document.presets?.find((item) => item.id === state.preset)
    sendParams(preset?.values ?? {}, true)
  }
  element("param-save").onclick = () =>
    void run(async () => {
      if (!input("param-name").reportValidity()) return
      const name = input("param-name").value.trim()
      if (!name || !state.revisionInfo || state.design?.ended) return
      const current = await api<Design.Info>(`/${state.design!.id}`)
      if (current.revision !== state.revision) throw new Error(copy.paramLatest)
      const preset: Design.ParamPreset = {
        id: `preset-${crypto.randomUUID()}`,
        name,
        values: structuredClone(state.params),
        ...(state.variant ? { variant: state.variant } : {}),
      }
      await api(`/${current.id}`, "PATCH", { presets: [...(current.presets ?? []), preset] })
      const revision = await api<Design.Revision>(`/${current.id}/revision`, "POST", {
        name: `${copy.paramScenario}: ${name}`,
      })
      await refresh()
      await chooseRevision(revision.id)
      state.preset = preset.id
      sendParams(preset.values, true)
      drawParams()
      save()
      input("param-name").value = ""
      status(copy.paramSaved, "paramSaved", "success")
    }, element("param-save"))

  const save = () => {
    if (!state.design) return
    try {
      localStorage.setItem(
        key(),
        JSON.stringify({
          notes: state.notes,
          params: state.params,
          component: state.component,
          preset: state.preset,
          assets: state.assets,
          snapshot: state.snapshot,
          text: input("note").value,
          pending: state.pending,
          boards: state.boards,
          board: state.board,
          variantPrompt: input("variant-prompt").value,
          variantPending: state.variantPending,
        }),
      )
    } catch {
      status(copy.failure, "failure")
    }
  }
  const drawNotes = () => {
    element("notes").replaceChildren(
      ...state.notes.map((note, index) => {
        const row = document.createElement("div")
        row.className = "note"
        row.textContent = `${note.label || note.target} — ${note.text}`
        const button = document.createElement("button")
        button.dataset.copy = "remove"
        button.textContent = copy.remove
        button.onclick = () => {
          if (state.pending) return
          state.notes.splice(index, 1)
          save()
          drawNotes()
        }
        row.append(button)
        return row
      }),
    )
    element<HTMLButtonElement>("send").textContent = state.pending ? copy.retry : copy.send
    element("send").dataset.copy = state.pending ? "retry" : "send"
    input("note").disabled = !!state.pending
  }
  const restoreDraft = () => {
    state.notes = []
    state.params = {}
    state.component = ""
    state.preset = ""
    state.assets = []
    state.snapshot = ""
    state.pending = undefined
    state.boards = []
    state.board = undefined
    state.variantPending = undefined
    input("variant-prompt").value = ""
    input("note").value = ""
    try {
      const stored = JSON.parse(localStorage.getItem(key()) ?? "null")
      if (stored) {
        state.notes = stored.notes ?? []
        state.params = stored.params ?? {}
        state.component = stored.component ?? ""
        state.preset = stored.preset ?? ""
        state.assets = stored.assets ?? []
        state.snapshot = stored.snapshot ?? ""
        state.pending = stored.pending
        state.boards = stored.boards ?? []
        state.board = stored.board
        state.variantPending = stored.variantPending
        input("variant-prompt").value = stored.variantPrompt ?? ""
        input("note").value = stored.text ?? ""
      }
    } catch {
      status(copy.failure, "failure")
    }
    drawNotes()
  }
  const drawSources = (revision?: Design.Revision) => {
    state.revisionInfo = revision
    text(
      "source-files",
      revision?.document.sources
        .map((item) => {
          const current = state.design?.sources.find((source) => source.file === item.file)
          return `${item.file} · ${new Date(item.observed).toLocaleString()} · ${item.hash.slice(0, 8)} · ${current?.hash === item.hash ? copy.sourceCurrent : copy.sourceChanged}`
        })
        .join("\n") ?? "",
    )
  }
  const drawEvidence = () => {
    const summary = root.querySelector<HTMLElement>("[data-review-evidence]")
    if (!summary) return
    summary.textContent = state.audits.length
      ? `${copy.evidence}: ${state.audits.map((job) => `${job.audit!.scenarios.length} · ${copy.findings}: ${job.audit!.findings.length}`).join("; ")}`
      : copy.noAudit
  }
  const pill = (key: "stateWorking" | "stateIdle" | "statePublished" | "feedUnavailable") => {
    const node = element("agent-state")
    node.dataset.state =
      key === "stateWorking" ? "working" : key === "stateIdle" ? "idle" : key === "statePublished" ? "published" : "off"
    node.dataset.copy = key
    node.textContent = copy[key]
  }
  const entryKey = (event: Design.FeedEvent) =>
    event.type === "published" ? `published:${event.revision}` : "id" in event ? `${event.type}:${event.id}` : ""
  const entry = (event: Design.FeedEvent) => {
    const row = document.createElement("div")
    row.className = "entry"
    row.dataset.kind = event.type
    row.dataset.key = entryKey(event)
    if (event.type === "user") {
      const who = document.createElement("strong")
      who.dataset.copy = "you"
      who.dataset.copySuffix = ": "
      who.textContent = `${copy.you}: `
      const notes = document.createElement("span")
      notes.dataset.copy = event.notes === 1 ? "feedNote" : "feedNotes"
      notes.dataset.copyPrefix = `${event.text ? " · " : ""}${event.notes} `
      notes.textContent = `${notes.dataset.copyPrefix}${event.notes === 1 ? copy.feedNote : copy.feedNotes}`
      row.append(who, event.text, ...(event.notes ? [notes] : []))
    }
    if (event.type === "reply") row.textContent = event.text
    if (event.type === "tool")
      row.textContent = `${event.tool} · ${event.status}${event.summary ? ` · ${event.summary}` : ""}`
    if (event.type === "published") {
      row.dataset.copy = "published"
      row.dataset.copySuffix = `: ${event.name}`
      row.textContent = `${copy.published}: ${event.name}`
    }
    return row
  }
  // The same entry can arrive twice (a reconnect replays history): the newest copy replaces its row
  // in place. The list follows new rows only while the reader is already at the bottom.
  const upsert = (event: Design.FeedEvent) => {
    const list = element("feed")
    const key = entryKey(event)
    const index = state.feed.findIndex((item) => entryKey(item) === key)
    const existing = list.querySelector<HTMLElement>(`.entry[data-key="${CSS.escape(key)}"]`)
    if (index >= 0) state.feed[index] = event
    if (index < 0) state.feed.push(event)
    if (existing) {
      existing.replaceWith(entry(event))
      return
    }
    const bottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
    list.append(entry(event))
    if (state.feed.length > 200) {
      state.feed.shift()
      list.querySelector(".entry")?.remove()
    }
    if (bottom) list.scrollTop = list.scrollHeight
  }
  const poll = () => {
    if (!state.loading && !state.working && !state.creating && !document.hidden && !root.querySelector("dialog[open]"))
      void run(refresh, undefined, true)
  }
  const onFeed = (event: Design.FeedEvent) => {
    if (state.stopped) return
    if (event.type === "state") {
      pill(event.state === "working" ? "stateWorking" : "stateIdle")
      return
    }
    if (event.type === "agent") return
    upsert(event)
    if (event.type !== "published") return
    pill("statePublished")
    if (event.revision !== state.revision && event.revision !== state.design?.revision) poll()
  }
  const chooseRevision = async (revisionID: string, keep = false) => {
    const revision = await api<Design.Revision[]>(`/${state.design!.id}/revision`).then((items) =>
      items.find((item) => item.id === revisionID),
    )
    if (!revision) return
    const response = await request(`${endpoint}/${state.design!.id}/revision/${revisionID}/preview`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => undefined)
      const message = typeof body?.message === "string" ? body.message : `${copy.failure} (${response.status})`
      state.failedPreview = revisionID
      element("preview-error").textContent = `${revision.name}: ${message}`
      element("preview-error").hidden = false
      element("primary-pane").hidden = true
      element("peer-pane").hidden = true
      controls()
      throw new Error(message)
    }
    const html = await response.text()
    state.failedPreview = ""
    element("preview-error").hidden = true
    element("primary-pane").hidden = false
    if (state.revision) save()
    if (state.revision !== revisionID && !keep) {
      state.variant = ""
      state.peer = ""
    }
    state.revision = revisionID
    // A live reload keeps the draft, the selected variants and the reader's scroll position.
    if (keep) save()
    if (!keep) restoreDraft()
    state.html = html
    if (!keep) state.variants = []
    state.restoreScroll = keep
    element<HTMLIFrameElement>("peer-preview").removeAttribute("srcdoc")
    element<HTMLIFrameElement>("preview").srcdoc = html
    if (keep && state.comparing) element<HTMLIFrameElement>("peer-preview").srcdoc = html
    input("revisions").value = revisionID
    element("newer").hidden = state.design?.revision === revisionID
    text("decisions", revision.document.decisions.map((item) => item.text).join("\n"))
    text("questions", revision.document.questions.join("\n"))
    text(
      "scenarios",
      revision.document.scenarios
        .map((item) => `${item.name}: ${item.state}${item.notApplicable ? ` (${item.notApplicable})` : ""}`)
        .join("\n"),
    )
    drawSources(revision)
    drawParams()
  }
  const refresh = async (designID = state.design?.id) => {
    const documents = await api<Design.Info[]>()
    element("designs").innerHTML = documents
      .map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`)
      .join("")
    const current = documents.find((item) => item.id === designID) ?? documents.at(-1)
    if (!current) return
    const changed = state.design?.id !== current.id
    const onLatest = !changed && !!state.revision && state.revision === state.design?.revision
    if (changed) {
      state.failedPreview = ""
      element("preview-error").hidden = true
      element("primary-pane").hidden = false
      save()
      state.revision = ""
      state.html = ""
      state.variants = []
      state.variant = ""
      state.peer = ""
      element<HTMLIFrameElement>("preview").removeAttribute("srcdoc")
      element<HTMLIFrameElement>("peer-preview").removeAttribute("srcdoc")
      drawVariants()
    }
    state.design = current
    // Lock stale revision actions before the remaining refresh requests can yield.
    controls()
    if (changed || state.approval?.revision.id !== current.approvedRevision)
      state.approval = current.approvedRevision
        ? await api<Design.Approval>(`/${current.id}/approval/${encodeURIComponent(current.approvedRevision)}`)
        : undefined
    element("approved-record").hidden = !state.approval
    if (state.approval) {
      const record = state.approval
      element("approved-details").textContent = [
        `${record.revision.document.name} · ${record.revision.name}`,
        record.variant ? `${record.variant.name} (${record.variant.id})` : copy.approvalWhole,
        `${copy.objective}: ${record.revision.document.brief.objective}`,
        `${copy.constraints}: ${record.revision.document.brief.constraints}`,
        `${copy.decisions}:\n${record.revision.document.decisions.map((item) => `• ${item.text}`).join("\n")}`,
        `${copy.scenarios}:\n${record.revision.document.scenarios.map((item) => `• ${item.name}: ${item.state}`).join("\n")}`,
      ].join("\n\n")
    }
    if (changed) restoreDraft()
    input("designs").value = current.id
    element("intake").hidden = true
    element("studio").hidden = false
    element("approve").hidden = current.ended
    element("reopen").hidden = !current.ended
    element<HTMLButtonElement>("send").disabled = current.ended && !state.pending
    const revisions = await api<Design.Revision[]>(`/${current.id}/revision`)
    element("revisions").innerHTML = revisions
      .map(
        (revision) =>
          `<option value="${escape(revision.id)}">${escape(revision.name)} · ${escape(revision.id.slice(-8))}</option>`,
      )
      .join("")
    const initial = changed || !state.revision
    // A new revision replaces the one on screen only while the reader is on the latest one and
    // nothing is in flight; while browsing history the button offers it instead.
    const live =
      !initial &&
      onLatest &&
      current.revision !== state.revision &&
      !state.pending &&
      !document.hidden &&
      !root.querySelector("dialog[open]")
    if (current.revision && (initial || live) && state.failedPreview !== current.revision) {
      await chooseRevision(current.revision, live)
      if (live) status(copy.published, "published", "success")
    }
    input("revisions").value = state.failedPreview || state.revision
    element("newer").hidden = current.revision === state.revision
    drawSources(revisions.find((revision) => revision.id === state.revision))
    element<HTMLButtonElement>("param-save").disabled =
      state.working || state.design?.revision !== state.revision || !!state.design?.ended
    const assets = await api<Design.Asset[]>(`/${current.id}/asset`)
    for (const [id, url] of thumbnails) {
      if (assets.some((asset) => asset.id === id)) continue
      URL.revokeObjectURL(url)
      thumbnails.delete(id)
    }
    await Promise.all(
      assets.map(async (asset) => {
        if (thumbnails.has(asset.id)) return
        const response = await request(`${endpoint}/${current.id}/asset/${asset.id}/file`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(copy.failure)
        const blob = await response.blob()
        if (!state.stopped) thumbnails.set(asset.id, URL.createObjectURL(blob))
      }),
    )
    element("assets").innerHTML =
      assets
        .map(
          (asset) =>
            `<div class="asset"><img alt="" src="${thumbnails.get(asset.id) ?? ""}"><span>${escape(asset.name)}<small>${escape(asset.source)}</small></span></div>`,
        )
        .join("") || copy.noAssets
    if (assets.length) delete element("assets").dataset.copy
    else element("assets").dataset.copy = "noAssets"
    const previous = input("svg").value
    element("svg").innerHTML = assets
      .filter((asset) => asset.mime === "image/svg+xml")
      .map((asset) => `<option value="${asset.id}">${escape(asset.name)}</option>`)
      .join("")
    if (assets.some((asset) => asset.id === previous)) input("svg").value = previous
    const jobs = await api<Design.Job[]>(`/${current.id}/job`)
    state.audits = jobs.filter((job) => job.input.revision === state.revision && job.audit)
    let summary = root.querySelector<HTMLElement>("[data-review-evidence]")
    if (!summary) {
      summary = document.createElement("div")
      summary.dataset.reviewEvidence = ""
      element("jobs").before(summary)
    }
    drawEvidence()
    element("jobs").replaceChildren(
      ...jobs.map((job) => {
        const row = document.createElement("div")
        row.className = "note"
        row.textContent = `${job.input.format} · ${job.status} · ${Math.round(job.progress * 100)}%${job.error ? ` · ${job.error}` : ""}`
        if (job.audit) {
          const details = document.createElement("details")
          const summary = document.createElement("summary")
          summary.dataset.copy = "findings"
          summary.dataset.copySuffix = `: ${job.audit.findings.length}`
          summary.textContent = `${copy.findings}: ${job.audit.findings.length}`
          const content = document.createElement("div")
          content.textContent = [...job.audit.scenarios, ...job.audit.findings].join("\n")
          content.style.whiteSpace = "pre-wrap"
          details.append(summary, content)
          row.append(details)
        }
        if (job.status === "queued" || job.status === "running" || job.status === "completed") {
          const button = document.createElement("button")
          button.dataset.copy = job.status !== "completed" ? "cancel" : "download"
          button.textContent = job.status !== "completed" ? copy.cancel : copy.download
          button.onclick = () =>
            void run(async () => {
              if (job.status !== "completed") {
                await api(`/${current.id}/job/${job.id}/cancel`, "POST")
                await refresh()
                return
              }
              const response = await request(`${endpoint}/${current.id}/job/${job.id}/file`, {
                signal: controller.signal,
              })
              if (!response.ok) throw new Error(copy.failure)
              const url = URL.createObjectURL(await response.blob())
              const anchor = document.createElement("a")
              anchor.href = url
              anchor.download = `${current.name}.${job.input.format === "gif" ? "gif" : "html"}`
              anchor.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            })
          row.append(button)
        }
        return row
      }),
    )
    const message = current.ended ? "closed" : current.revision ? "draft" : "waiting"
    text("review-state", copy[message])
    element("review-state").dataset.copy = message
    element("review-state").hidden = !current.ended && !!current.revision
    controls()
  }
  const click = (id: string, action: () => Promise<void>) => {
    element(id).onclick = () => void run(action, element(id))
  }
  click("refresh", async () => {
    const failed = state.failedPreview
    await refresh()
    const revision = failed && state.failedPreview === failed ? failed : state.revision
    if (revision) await chooseRevision(revision)
    status(copy.refreshed, "refreshed", "success")
  })
  click("new", async () => {
    state.creating = true
    save()
    element("intake").hidden = false
    element("studio").hidden = true
  })
  element<HTMLFormElement>("create").onsubmit = (event) => {
    event.preventDefault()
    void run(async () => {
      const created = await api<Design.Info>("", "POST", {
        name: input("name").value,
        journey: input("journey").value,
        engine: input("engine").value,
        application: input("application").value,
        kind: "screen",
      })
      await api(`/${created.id}`, "PATCH", {
        brief: {
          objective: input("objective").value,
          audience: input("audience").value,
          constraints: input("constraints").value,
          references: input("references").value.split("\n").filter(Boolean),
          content: "",
        },
      })
      const revision = await api<Design.Revision>(`/${created.id}/revision`, "POST", { name: copy.create })
      await api(`/${created.id}/feedback`, "POST", {
        id: `msg_${crypto.randomUUID()}`,
        revision: revision.id,
        text: `${input("objective").value}\n${input("constraints").value}`,
        items: [],
        assets: [],
        snapshot: "",
        delivery: "steer",
        end: false,
      })
      state.creating = false
      await refresh(created.id)
    })
  }
  element("designs").onchange = () => void run(() => refresh(input("designs").value as Design.ID))
  element("revisions").onchange = () => void run(() => chooseRevision(input("revisions").value))
  element("width").onchange = () => {
    for (const id of ["preview", "peer-preview"])
      element(id).style.width = input("width").value === "100%" ? "100%" : `${input("width").value}px`
  }
  click("newer", async () => {
    if (state.design?.revision) await chooseRevision(state.design.revision)
  })
  click("restore", async () => {
    const result = await api<Design.Revision>(`/${state.design!.id}/restore`, "POST", { revision: state.revision })
    await refresh()
    await chooseRevision(result.id)
  })
  click("approve", async () => {
    state.approving = {
      revision: state.revision,
      ...(state.variant ? { variant: state.variants.find((item) => item.id === state.variant) } : {}),
    }
    element("approval-revision").textContent =
      `${state.design?.name} · ${state.revisionInfo?.name}\n${state.approving.variant?.name ?? copy.approvalWhole}`
    element<HTMLDialogElement>("approve-dialog").showModal()
    element("cancel-approve").focus()
  })
  element("cancel-approve").onclick = () => element<HTMLDialogElement>("approve-dialog").close()
  click("confirm-approve", async () => {
    if (!state.approving) return
    await api(`/${state.design!.id}/approve`, "POST", state.approving)
    element<HTMLDialogElement>("approve-dialog").close()
    await refresh()
    status(copy.approved, "approved", "success")
  })
  click("reopen", async () => {
    await api(`/${state.design!.id}/reopen`, "POST")
    await refresh()
  })
  click("refresh-system", async () => {
    await api(`/${state.design!.id}/refresh`, "POST")
    await refresh()
  })
  input("note").oninput = save
  click("add", async () => {
    if (state.pending || !input("note").value.trim()) return
    const picked = state.selection
    state.notes.push({
      target: element("target").textContent || "page",
      params: paramContext(),
      revision: state.revision,
      text: input("note").value.trim(),
      ...(picked.tag
        ? {
            tag: picked.tag,
            elementText: picked.elementText,
            label: picked.elementText ? `${picked.tag} "${picked.elementText.slice(0, 40)}"` : picked.tag,
          }
        : {}),
      ...(picked.selectedText ? { selectedText: picked.selectedText } : {}),
    })
    input("note").value = ""
    save()
    drawNotes()
  })
  click("send", async () => {
    if (!state.revision) return
    if (!state.pending && !state.notes.length && !input("note").value.trim()) throw new Error(copy.feedbackRequired)
    state.pending ??= {
      id: `msg_${crypto.randomUUID()}` as Design.Feedback["id"],
      revision: state.revision,
      params: paramContext(),
      text: input("note").value.trim(),
      items: [...state.notes],
      assets: [...state.assets],
      snapshot: state.snapshot,
      whiteboards: [...state.boards],
      delivery: input("queue").checked ? "queue" : "steer",
      end: input("end").checked,
    }
    save()
    drawNotes()
    await api(`/${state.design!.id}/feedback`, "POST", state.pending)
    const sent = state.pending
    if (options.feed)
      upsert({ type: "user", id: sent.id, seq: 0, at: Date.now(), text: sent.text, notes: sent.items.length })
    state.pending = undefined
    state.notes = []
    state.assets = []
    state.boards = []
    state.snapshot = ""
    input("note").value = ""
    save()
    drawNotes()
    status(copy.received, "received")
  })
  element("add-variant").onclick = () => {
    element<HTMLDialogElement>("variant-dialog").showModal()
    input("variant-prompt").focus()
  }
  element("cancel-variant").onclick = () => element<HTMLDialogElement>("variant-dialog").close()
  input("variant-prompt").oninput = save
  const requestVariant = async (organize = false) => {
    state.variantPending ??= {
      id: `msg_${crypto.randomUUID()}` as Design.Feedback["id"],
      revision: state.revision,
      text: organize
        ? "Separate the existing alternatives in this prototype into selectable variants. Preserve their appearance; wrap each entire alternative in a non-nested data-design-variant root with a unique stable ID and data-design-label. Publish a new revision on this same design."
        : `Add one new variant to this design. Preserve the existing alternatives. Wrap each alternative in a non-nested data-design-variant root with a unique stable ID and data-design-label; publish a new revision on this same design. Reference variant: ${state.variant || "current prototype"}.\n\nUser request:\n${input("variant-prompt").value.trim()}`,
      items: [],
      assets: [],
      snapshot: "",
      delivery: input("queue").checked ? "queue" : "steer",
      end: false,
    }
    save()
    await api(`/${state.design!.id}/feedback`, "POST", state.variantPending)
    state.variantPending = undefined
    input("variant-prompt").value = ""
    save()
    element<HTMLDialogElement>("variant-dialog").close()
    status(
      organize ? copy.organizeRequested : copy.variantRequested,
      organize ? "organizeRequested" : "variantRequested",
      "success",
    )
  }
  element<HTMLFormElement>("variant-form").onsubmit = (event) => {
    event.preventDefault()
    void run(() => requestVariant(), element("request-variant"))
  }
  click("organize-variants", () => requestVariant(true))
  for (const id of ["view-single", "view-compare"])
    element(id).onclick = () => {
      state.comparing = id === "view-compare"
      drawVariants()
    }
  element("peer-variant").onchange = () => {
    state.peer = input("peer-variant").value
    drawVariants()
  }
  input("attachment").onchange = () =>
    void run(async () => {
      const file = input("attachment").files?.[0]
      if (!file || state.pending) return
      if (file.size > 10 * 1024 * 1024) throw new Error(copy.failure)
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const asset = await api<Design.Asset>(`/${state.design!.id}/asset`, "POST", {
        name: file.name,
        mime: file.type || (file.name.endsWith(".svg") ? "image/svg+xml" : ""),
        data,
        source: "user",
      })
      state.assets.push(asset.id)
      save()
      await refresh()
    })
  const publishTweaks = async (tweaks: Design.Info["tweaks"]) => {
    await api(`/${state.design!.id}`, "PATCH", { tweaks })
    const revision = await api<Design.Revision>(`/${state.design!.id}/revision`, "POST", { name: copy.tweaks })
    await refresh()
    await chooseRevision(revision.id)
  }
  click("apply", () => publishTweaks({ ...state.design!.tweaks, [input("token").value]: input("value").value }))
  click("reset", () => publishTweaks({}))
  for (const format of ["html", "audit", "gif", "compare"] as const)
    click(format, async () => {
      if (!state.revision) return
      await api(`/${state.design!.id}/job`, "POST", {
        revision: format === "compare" ? state.design!.approvedRevision : state.revision,
        format,
        ...(format === "compare" ? { implementation: input("implementation").value } : {}),
        ...(format === "gif"
          ? {
              asset: input("svg").value,
              duration: Number(input("duration").value),
              fps: Number(input("fps").value),
              size: Number(input("size").value),
              transparent: input("transparent").checked,
            }
          : {}),
      })
      await refresh()
    })
  element<HTMLIFrameElement>("peer-preview").onload = () =>
    element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
      { type: "design:variant", id: state.peer },
      "*",
    )
  element<HTMLIFrameElement>("preview").onload = () => {
    sendParams(state.params, true)
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:annotate", enabled: input("annotate").checked },
      "*",
    )
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage({ type: "design:variant", id: state.variant }, "*")
  }
  element("annotate").onchange = () => {
    if (input("annotate").checked) {
      input("param-select").checked = false
      element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
        { type: "design:params-select", enabled: false },
        "*",
      )
    }
    for (const id of ["preview", "peer-preview"])
      element<HTMLIFrameElement>(id).contentWindow?.postMessage(
        { type: "design:annotate", enabled: input("annotate").checked },
        "*",
      )
  }
  click("whiteboard", async () => {
    const response = await request(`${endpoint}/whiteboard`, { signal: controller.signal })
    if (!response.ok) throw new Error(copy.failure)
    state.channel = crypto.randomUUID()
    element<HTMLDialogElement>("board-dialog").showModal()
    element<HTMLIFrameElement>("board-frame").srcdoc = await response.text()
  })
  click("board-close", async () => {
    element<HTMLDialogElement>("board-dialog").close()
    save()
  })
  input("value").oninput = () =>
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:tweak", key: input("token").value, value: input("value").value },
      "*",
    )
  const message = (event: MessageEvent) => {
    if (
      event.source === element<HTMLIFrameElement>("preview").contentWindow &&
      event.data?.type === "design:params-get"
    ) {
      sendParams(state.params, true)
      return
    }
    if (
      event.source === element<HTMLIFrameElement>("preview").contentWindow &&
      event.data?.type === "design:params-state"
    ) {
      const values: Design.ParamValues = Object.fromEntries(
        (state.revisionInfo?.document.controls ?? []).map((component) => [
          component.id,
          Object.fromEntries(
            component.fields.map((field) => {
              const value = event.data.values?.[component.id]?.[field.id]
              const valid =
                field.type === "number"
                  ? typeof value === "number" &&
                    Number.isFinite(value) &&
                    (field.min === undefined || value >= field.min) &&
                    (field.max === undefined || value <= field.max)
                  : field.type === "boolean"
                    ? typeof value === "boolean"
                    : typeof value === "string" &&
                      value.length <= 4000 &&
                      (field.type !== "select" || field.options.includes(value))
              return [field.id, valid ? value : field.default]
            }),
          ),
        ]),
      )
      state.params = values
      syncParams()
      save()
      return
    }
    if (
      event.source === element<HTMLIFrameElement>("preview").contentWindow &&
      event.data?.type === "design:params-component"
    ) {
      if (!paramComponents().some((item) => item.id === event.data.component)) return
      state.component = event.data.component
      selectTab("params")
      drawParams()
      save()
      return
    }
    if (event.data?.type === "design:variants") {
      if (event.source === element<HTMLIFrameElement>("peer-preview").contentWindow) {
        element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
          { type: "design:variant", id: state.peer },
          "*",
        )
        element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
          { type: "design:annotate", enabled: input("annotate").checked },
          "*",
        )
        return
      }
      if (event.source !== element<HTMLIFrameElement>("preview").contentWindow || !Array.isArray(event.data.variants))
        return
      if (state.restoreScroll) {
        state.restoreScroll = false
        element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
          { type: "design:scroll-set", ...state.scroll },
          "*",
        )
        element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
          { type: "design:scroll-set", ...state.peerScroll },
          "*",
        )
      }
      state.variants = event.data.variants
        .slice(0, 20)
        .filter(
          (item: unknown): item is { id: string; name: string } =>
            !!item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string" &&
            /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
            "name" in item &&
            typeof item.name === "string",
        )
        .filter(
          (item: { id: string }, index: number, items: { id: string }[]) =>
            items.findIndex((other) => other.id === item.id) === index,
        )
      if (!state.variants.some((item) => item.id === state.variant)) state.variant = state.variants[0]?.id ?? ""
      drawVariants()
      drawParams()
      return
    }
    if (event.data?.type === "design:scroll" && typeof event.data.x === "number" && typeof event.data.y === "number") {
      if (event.source === element<HTMLIFrameElement>("preview").contentWindow)
        state.scroll = { x: event.data.x, y: event.data.y }
      if (event.source === element<HTMLIFrameElement>("peer-preview").contentWindow)
        state.peerScroll = { x: event.data.x, y: event.data.y }
      return
    }
    if (event.source === element<HTMLIFrameElement>("board-frame").contentWindow) {
      const data = event.data
      const reply = (value: object) =>
        element<HTMLIFrameElement>("board-frame").contentWindow?.postMessage(
          { ...value, channelId: state.channel },
          "*",
        )
      if (data?.type === "redcode-whiteboard:ready") {
        reply({
          type: "redcode-whiteboard:init",
          source: input("selection").value,
          sourceHash: input("selection").value,
          diagramIndex: 0,
          diagramId: element("target").textContent || "diagram",
          mode: "overlay",
          theme: "light",
          saved: state.board,
        })
        return
      }
      if (data?.channelId !== state.channel) return
      if (data.type === "redcode-whiteboard:save") {
        state.board = {
          scene: data.scene,
          source_hash: data.sourceHash,
          baseline: data.baseline,
          text_metrics_version: data.textMetricsVersion,
        }
        save()
        reply({ type: "redcode-whiteboard:saveResult", ok: true, flushId: data.flushId })
        return
      }
      if (data.type === "redcode-whiteboard:queueFeedback") {
        void run(async () => {
          try {
            if (state.pending) throw new Error(copy.failure)
            if (typeof data.pngDataUrl === "string" && data.pngDataUrl.startsWith("data:image/png;base64,")) {
              const asset = await api<Design.Asset>(`/${state.design!.id}/asset`, "POST", {
                name: "whiteboard.png",
                mime: "image/png",
                data: data.pngDataUrl.split(",")[1],
                source: "whiteboard",
              })
              state.assets.push(asset.id)
            }
            const target = element("target").textContent || "diagram"
            state.boards.push({ target, scene: { type: "excalidraw", version: 2, source: "redcode", ...data.scene } })
            state.notes.push({
              target,
              revision: state.revision,
              text:
                [String(data.note || ""), ...(Array.isArray(data.summaryLines) ? data.summaryLines.map(String) : [])]
                  .filter(Boolean)
                  .join("\n") || copy.whiteboard,
            })
            save()
            drawNotes()
            reply({ type: "redcode-whiteboard:queueResult", ok: true })
            element<HTMLDialogElement>("board-dialog").close()
          } catch (error) {
            reply({
              type: "redcode-whiteboard:queueResult",
              ok: false,
              error: error instanceof Error ? error.message : copy.failure,
            })
            throw error
          }
        })
      }
      return
    }
    if (
      event.source === element<HTMLIFrameElement>("preview").contentWindow &&
      event.data?.type === "design:layout" &&
      Array.isArray(event.data.findings)
    ) {
      text(
        "findings",
        event.data.findings
          .slice(0, 30)
          .filter(
            (item: unknown): item is { target: string; text: string } =>
              !!item &&
              typeof item === "object" &&
              "text" in item &&
              typeof item.text === "string" &&
              "target" in item &&
              typeof item.target === "string",
          )
          .map((item: { target: string; text: string }) => `${item.target}: ${item.text}`)
          .join("\n"),
      )
      return
    }
    if (
      (event.source !== element<HTMLIFrameElement>("preview").contentWindow &&
        (!state.comparing || event.source !== element<HTMLIFrameElement>("peer-preview").contentWindow)) ||
      event.data?.type !== "design:selection"
    )
      return
    if (typeof event.data.target !== "string" || typeof event.data.text !== "string") return
    element("target").textContent = event.data.target.slice(0, 1000)
    input("selection").value = event.data.text.slice(0, 12000)
    state.snapshot = typeof event.data.snapshot === "string" ? event.data.snapshot.slice(0, 30000) : ""
    const field = (name: string, limit: number) =>
      typeof event.data[name] === "string" ? String(event.data[name]).slice(0, limit) : ""
    state.selection = {
      tag: field("tag", 64),
      elementText: field("elementText", 240),
      selectedText: field("selectedText", 12000),
    }
    save()
  }
  window.addEventListener("message", message)
  const timer = setInterval(poll, 5000)
  // A reload deferred while the tab was hidden happens as soon as it is visible again.
  document.addEventListener("visibilitychange", poll)
  element("feed").hidden = !options.feed
  element("agent-state").hidden = !options.feed
  if (options.feed)
    options.feed(`${endpoint}/feed`, transport, controller.signal, onFeed, () => {
      if (!state.stopped) pill("feedUnavailable")
    })
  void run(refresh)
  const dispose = () => {
    save()
    scheme.removeEventListener("change", syncScheme)
    schemeObserver.disconnect()
    state.stopped = true
    controller.abort()
    thumbnails.forEach((url) => URL.revokeObjectURL(url))
    thumbnails.clear()
    clearInterval(timer)
    document.removeEventListener("visibilitychange", poll)
    window.removeEventListener("message", message)
    root.replaceChildren()
  }
  return Object.assign(dispose, {
    updateCopy(next: ReviewCopy) {
      if (state.stopped) return
      Object.assign(copy, next)
      root.querySelectorAll<HTMLElement>("[data-copy]").forEach((node) => {
        node.textContent =
          (node.dataset.copyPrefix ?? "") +
          copy[node.dataset.copy as keyof ReviewCopy] +
          (node.dataset.copySuffix ?? "")
      })
      for (const attribute of ["aria-label", "title"]) {
        root.querySelectorAll<HTMLElement>(`[data-copy-${attribute}]`).forEach((node) => {
          node.setAttribute(attribute, copy[node.getAttribute(`data-copy-${attribute}`) as keyof ReviewCopy])
        })
      }
      drawSources(state.revisionInfo)
      drawEvidence()
    },
  })
}

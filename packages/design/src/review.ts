import type { Design } from "@reddb-io/redcode-schema/design"
import type { ReviewCopy } from "./copy"

export interface ReviewOptions {
  base: string
  endpoint?: string
  sessionID: string
  copy: ReviewCopy
  request?: (url: string, init?: RequestInit) => Promise<Response>
}

/** Shared native review surface. The standalone host serializes this self-contained function. */
export function mountReview(host: HTMLElement, options: ReviewOptions) {
  const copy = { ...options.copy }
  const transport = options.request ?? fetch
  const request = (url: string, init?: RequestInit) =>
    transport(url, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) })
  const root = host.attachShadow({ mode: "open" })
  const endpoint =
    options.endpoint ?? `${options.base.replace(/\/$/, "")}/api/session/${encodeURIComponent(options.sessionID)}/design`
  const state = {
    creating: false,
    design: undefined as Design.Info | undefined,
    revision: "",
    revisionInfo: undefined as Design.Revision | undefined,
    audits: [] as Design.Job[],
    notes: [] as { target: string; text: string }[],
    assets: [] as string[],
    snapshot: "",
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
  root.innerHTML = `<style>
:host{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color-scheme:light dark;--surface:var(--background-base,light-dark(oklch(98.5% .003 220),oklch(21% .005 220)));--panel:light-dark(oklch(96.5% .004 220),oklch(24% .006 220));--canvas:light-dark(oklch(93% .006 220),oklch(17% .005 220));--ink:var(--text-base,light-dark(oklch(29% .012 220),oklch(92% .006 220)));--muted:light-dark(oklch(49% .015 220),oklch(69% .012 220));--edge:light-dark(oklch(88% .008 220),oklch(33% .008 220));--accent:light-dark(oklch(47% .085 220),oklch(79% .10 215));--accent-ink:light-dark(oklch(99% .003 220),oklch(20% .025 220));background:var(--surface);color:var(--ink);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}[hidden]{display:none!important}button,input,select,textarea{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--edge);border-radius:6px;padding:7px 10px;min-width:0}button{cursor:pointer;line-height:18px;transition:background-color 150ms ease,border-color 150ms ease}button:hover{background:var(--panel);border-color:var(--muted)}button:active{background:var(--canvas)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled{opacity:.45;cursor:default}.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}.primary:hover{background:color-mix(in oklch,var(--accent) 88%,var(--ink));border-color:var(--accent)}
header{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--edge);flex:none;min-width:0}h1{font-size:14px;letter-spacing:-.02em;margin:0 18px 0 0;display:flex;align-items:center;gap:8px}h1::before{content:"";width:8px;height:8px;background:var(--accent);border-radius:50%}h2{font-size:15px;letter-spacing:-.015em;margin:0 0 12px}header select{width:auto;max-width:280px;flex:0 1 240px}header #new{margin-left:auto}header #refresh{background:transparent}#studio>header{padding:8px 16px;background:var(--panel)}#studio>header #revisions{margin-right:auto}#width{flex:0 0 auto;width:auto;max-width:120px}#restore{border-color:transparent;background:transparent;color:var(--muted)}#approve,#reopen{white-space:nowrap}
#studio{flex:1;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr)}main{min-height:0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 336px;overflow:hidden}.canvas{background:var(--canvas);overflow:auto;min-height:0;min-width:0;padding:24px}iframe{display:block;background:oklch(99% .002 220);border:0;height:100%;min-height:0;width:100%;margin:0 auto;box-shadow:0 0 0 1px var(--edge),0 6px 24px color-mix(in oklch,var(--ink) 7%,transparent)}aside{min-height:0;min-width:0;border-left:1px solid var(--edge);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}.tabs{display:flex;padding:0 16px;border-bottom:1px solid var(--edge);gap:18px}.tabs button{border:0;border-radius:0;background:none;padding:13px 0;color:var(--muted);position:relative}.tabs button[aria-selected=true]{color:var(--ink);font-weight:600}.tabs button[aria-selected=true]::after{content:"";position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--accent)}.panel{overflow:auto;min-height:0;padding:20px}.panel>p{margin:0 0 16px}.section{margin-top:24px;padding-top:18px;border-top:1px solid var(--edge)}label{display:grid;gap:6px;margin-bottom:14px;font-size:12px;font-weight:500}label input,label select,label textarea{font-size:13px;font-weight:400}textarea{min-height:96px;resize:vertical;width:100%;line-height:1.55}input:not([type=checkbox]),select{max-width:100%;width:100%}input[type=checkbox]{accent-color:var(--accent);margin:0}label.check{display:flex;align-items:center;gap:8px;font-weight:400}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1;min-width:0}#note{min-height:116px}#send{width:100%;margin:14px 0 8px}#add{margin-bottom:14px}#attachment{font-size:11px;padding:6px;width:100%}#attachment::file-selector-button{font:inherit;border:0;border-radius:3px;padding:4px 7px;margin-right:8px;background:var(--panel);color:var(--ink);cursor:pointer}
details{border-top:1px solid var(--edge);padding:14px 0}summary{cursor:pointer;font-weight:600;list-style-position:inside;color:var(--ink);margin-bottom:0}details[open]>summary{margin-bottom:14px}details:last-child{padding-bottom:0}.note{padding:10px 0;border-bottom:1px solid var(--edge);overflow-wrap:anywhere}.note button{float:right;padding:2px 7px;font-size:11px}.muted,small{font-size:12px;color:var(--muted);font-weight:400}small{display:block}#draft{margin-bottom:12px}#target{overflow-wrap:anywhere;background:var(--panel);font:11px/1.5 ui-monospace,monospace;padding:7px 9px;border-radius:4px;margin:12px 0}#target:empty{display:none}#notes:empty{display:none}#notes{margin-bottom:16px}#status{flex:none;min-height:28px;padding:5px 16px;border-top:1px solid var(--edge);font-size:11px;color:var(--muted)}#status:empty{display:none}#newer{color:var(--accent)}.asset{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--edge)}.asset img{width:48px;height:48px;object-fit:contain;background:var(--panel);border-radius:4px}#jobs .note{display:grid;gap:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#source-files{font-size:12px;overflow-wrap:anywhere}#html,#audit,#compare,#gif{margin-bottom:12px}#intake{flex:1;overflow:auto}form.intake{max-width:600px;margin:32px auto;padding:24px}form.intake h2{font-size:24px;margin-bottom:24px}#board-dialog{padding:12px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}#board-dialog::backdrop{background:color-mix(in oklch,var(--canvas) 70%,transparent)}#board-close{margin-bottom:12px}#board-frame{box-shadow:none}.canvas:has(iframe[src="about:blank"])::before{content:attr(data-empty);display:block;color:var(--muted);text-align:center;padding:24px}
@container(max-width:900px){header{gap:6px;padding:8px 12px}h1{margin-right:8px}header select{flex-basis:160px;max-width:200px}#restore{font-size:0;width:32px;height:32px;flex:none;padding:0}#restore::before{content:"↶";font-size:20px}main{grid-template-columns:minmax(0,1fr) 300px}.canvas{padding:16px}.panel{padding:16px}}
@container(max-width:640px){:host{min-height:0}header{flex-wrap:wrap}header h1{font-size:13px}header #designs{flex:1;max-width:none}header #new{margin-left:0}#studio>header{flex-wrap:wrap}#studio>header #revisions{flex:1;max-width:none}#width{max-width:100px}#approve,#reopen{font-size:12px}main{display:grid;grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(220px,.85fr)}.canvas{padding:12px}aside{border-left:0;border-top:1px solid var(--edge)}.tabs{gap:24px}.tabs button{padding:10px 0}.panel{padding:16px}form.intake{margin:0;padding:20px}}
.variant-bar{display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid var(--edge);min-width:0;flex-wrap:wrap}.variant-bar .tabs{border:0;padding:0;flex:1;overflow:auto;gap:16px}.variant-bar .tabs button{white-space:nowrap}.variant-bar>button{margin:6px 0;white-space:nowrap}.variant-bar>button[aria-pressed=true]{background:var(--panel);border-color:var(--accent);color:var(--accent)}.variant-bar #add-variant{margin-right:auto}.canvas{display:flex;gap:20px;padding:16px}.preview-pane{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%}.viewport{flex:1;min-height:0;overflow:auto;padding:1px}.viewport iframe{height:100%;min-height:150px}.pane-label{height:38px;flex:none;font-size:12px;display:flex;align-items:center;gap:8px;margin:0;padding-bottom:6px}.pane-label select{width:auto;flex:1;padding:4px 8px}.canvas[data-comparing=true] .preview-pane{min-width:280px}.action-dialog{width:min(520px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:24px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}.action-dialog::backdrop{background:#0008}.action-dialog p{overflow-wrap:anywhere}.action-dialog .row{justify-content:flex-end}.action-dialog .row>*{flex:0 1 auto}#status{font-size:13px;min-height:38px;padding:9px 16px;background:var(--panel);border-bottom:1px solid var(--edge);border-top:0;color:var(--ink)}#status[data-tone=error]{color:light-dark(#a52a25,#ffa59d)}#status[data-tone=success]{color:light-dark(#226044,#90d7b0)}button[aria-busy=true]{opacity:1;cursor:progress}button[aria-busy=true]::before{content:"";display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.preview-pane[aria-busy=true] .viewport{opacity:.5}#width{max-width:180px}@container(max-width:640px){.variant-bar{padding:0 12px;gap:6px}.variant-bar .tabs{flex-basis:100%}.canvas{padding:12px;gap:12px}.variant-bar>button{font-size:12px}#width{max-width:165px}}
@media(prefers-reduced-motion:reduce){button{transition:none}button[aria-busy=true]::before{animation:none}}
    </style><header><h1><span data-copy="title">${copy.title}</span></h1><select id="designs" aria-label="${copy.alternatives}" data-copy-aria-label="alternatives"></select><button id="new"><span data-copy="create">${copy.create}</span></button><button id="refresh"><span data-copy="refresh">${copy.refresh}</span></button></header>
    <section id="intake"><form class="intake" id="create"><h2><span data-copy="create">${copy.create}</span></h2><label><span data-copy="name">${copy.name}</span><input id="name" required></label><div class="row"><label><span data-copy="journey">${copy.journey}</span><select id="journey"><option value="new" data-copy="new">${copy.new}</option><option value="existing" data-copy="existing">${copy.existing}</option></select></label><label><span data-copy="engine">${copy.engine}</span><select id="engine"><option value="html">HTML</option><option value="react">React</option><option value="solid">Solid</option></select></label></div><label><span data-copy="application">${copy.application}</span><input id="application" value="."></label><label><span data-copy="objective">${copy.objective}</span><textarea id="objective" required></textarea></label><label><span data-copy="audience">${copy.audience}</span><input id="audience"></label><label><span data-copy="constraints">${copy.constraints}</span><textarea id="constraints"></textarea></label><label><span data-copy="references">${copy.references}</span><textarea id="references"></textarea></label><button class="primary"><span data-copy="create">${copy.create}</span></button></form></section>
    <section id="studio" hidden><header><select id="revisions" aria-label="${copy.history}" data-copy-aria-label="history"></select><button id="newer" hidden><span data-copy="latest">${copy.latest}</span></button><select id="width" aria-label="${copy.width}" data-copy-aria-label="width"><option value="100%" data-copy="full">${copy.full}</option><option value="390" data-copy="mobile">${copy.mobile}</option><option value="768" data-copy="tablet">${copy.tablet}</option><option value="1440" data-copy="desktop">${copy.desktop}</option></select><button id="restore" title="${copy.restore}" data-copy-title="restore" aria-label="${copy.restore}" data-copy-aria-label="restore"><span data-copy="restore">${copy.restore}</span></button><button id="approve" class="primary"><span data-copy="approve">${copy.approve}</span></button><button id="reopen" hidden><span data-copy="reopen">${copy.reopen}</span></button></header><div class="variant-bar"><div id="variants" class="tabs" role="tablist" aria-label="${copy.variants}" data-copy-aria-label="variants"></div><span id="no-variants" class="muted" data-copy="noVariants">${copy.noVariants}</span><button id="organize-variants" data-copy="organizeVariants">${copy.organizeVariants}</button><button id="add-variant" data-copy="addVariant">${copy.addVariant}</button><button id="view-single" aria-pressed="true" data-copy="single">${copy.single}</button><button id="view-compare" aria-pressed="false" data-copy="sideBySide">${copy.sideBySide}</button></div><main><div class="canvas" id="canvas"><section class="preview-pane" id="primary-pane" role="tabpanel"><div class="pane-label" id="primary-label" hidden></div><div class="viewport"><iframe id="preview" title="${copy.review}" data-copy-title="review" sandbox="allow-scripts allow-forms" allow=""></iframe></div></section><section class="preview-pane" id="peer-pane" hidden><label class="pane-label"><span data-copy="compareVariant">${copy.compareVariant}</span><select id="peer-variant"></select></label><div class="viewport"><iframe id="peer-preview" title="${copy.compareVariant}" data-copy-title="compareVariant" sandbox="allow-scripts allow-forms" allow=""></iframe></div></section></div><aside><div class="tabs" role="tablist" aria-label="${copy.review}"><button type="button" role="tab" id="tab-review" aria-controls="panel-review" aria-selected="true" tabindex="0"><span data-copy="review">${copy.review}</span></button><button type="button" role="tab" id="tab-assets" aria-controls="panel-assets" aria-selected="false" tabindex="-1"><span data-copy="assets">${copy.assets}</span></button><button type="button" role="tab" id="tab-details" aria-controls="panel-details" aria-selected="false" tabindex="-1"><span data-copy="details">${copy.details}</span></button></div><section class="panel" role="tabpanel" id="panel-review" aria-labelledby="tab-review"><h2><span data-copy="review">${copy.review}</span></h2><p id="review-state" class="muted"></p><label class="check"><input id="annotate" type="checkbox"><span data-copy="annotate">${copy.annotate}</span></label><p class="muted"><span data-copy="inspect">${copy.inspect}</span></p><small id="target"></small><label><span data-copy="notes">${copy.notes}</span><textarea id="note"></textarea></label><button id="add"><span data-copy="add">${copy.add}</span></button><div id="notes"></div><label><span data-copy="attachment">${copy.attachment}</span><input id="attachment" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"></label><small id="draft"><span data-copy="draft">${copy.draft}</span></small><label class="check"><input type="checkbox" id="queue"><span data-copy="queue">${copy.queue}</span></label><label class="check"><input type="checkbox" id="end"><span data-copy="end">${copy.end}</span></label><button id="send" class="primary"><span data-copy="send">${copy.send}</span></button>
    <details><summary><span data-copy="diagram">${copy.diagram}</span></summary><label><span data-copy="diagram">${copy.diagram}</span><textarea id="selection"></textarea></label><button type="button" id="whiteboard"><span data-copy="whiteboard">${copy.whiteboard}</span></button></details></section><section class="panel" role="tabpanel" id="panel-assets" aria-labelledby="tab-assets" hidden><details open><summary><span data-copy="assets">${copy.assets}</span></summary><div id="assets"></div></details><details open><summary><span data-copy="export">${copy.export}</span></summary><button id="html"><span data-copy="html">${copy.html}</span></button><button id="audit"><span data-copy="audit">${copy.audit}</span></button><label><span data-copy="implementation">${copy.implementation}</span><input id="implementation" value="dist"></label><button id="compare"><span data-copy="compare">${copy.compare}</span></button><label><span data-copy="source">${copy.source}</span><select id="svg"></select></label><div class="row"><label><span data-copy="duration">${copy.duration}</span><input id="duration" type="number" min="0.1" max="10" step="0.1" value="3"></label><label><span data-copy="fps">${copy.fps}</span><input id="fps" type="number" min="1" max="25" value="20"></label></div><label><span data-copy="size">${copy.size}</span><input id="size" type="number" min="16" max="1024" value="512"></label><label class="check"><input type="checkbox" id="transparent"><span data-copy="transparent">${copy.transparent}</span></label><button id="gif"><span data-copy="gif">${copy.gif}</span></button></details><details open><summary><span data-copy="jobs">${copy.jobs}</span></summary><div id="jobs"></div></details>
    </section><section class="panel" role="tabpanel" id="panel-details" aria-labelledby="tab-details" hidden>
    <details><summary><span data-copy="findings">${copy.findings}</span></summary><div id="findings"></div></details><details><summary><span data-copy="system">${copy.system}</span></summary><div id="source-files"></div><button id="refresh-system"><span data-copy="refreshSystem">${copy.refreshSystem}</span></button></details><details><summary><span data-copy="decisions">${copy.decisions}</span></summary><div id="decisions"></div><h2><span data-copy="questions">${copy.questions}</span></h2><div id="questions"></div><h2><span data-copy="scenarios">${copy.scenarios}</span></h2><div id="scenarios"></div></details>
    <details><summary><span data-copy="tweaks">${copy.tweaks}</span></summary><label><span data-copy="token">${copy.token}</span><input id="token" value="--accent"></label><label><span data-copy="value">${copy.value}</span><input id="value" value="#285b49"></label><button id="apply"><span data-copy="apply">${copy.apply}</span></button><button id="reset"><span data-copy="reset">${copy.reset}</span></button></details>
    </section></aside></main></section><dialog id="board-dialog" style="width:95vw;height:90vh;max-width:1400px"><button id="board-close"><span data-copy="close">${copy.close}</span></button><iframe id="board-frame" title="${copy.whiteboard}" data-copy-title="whiteboard" sandbox="allow-scripts" style="height:calc(100% - 50px);width:100%"></iframe></dialog><dialog id="approve-dialog" class="action-dialog" aria-labelledby="approve-heading"><h2 id="approve-heading" data-copy="confirm">${copy.confirm}</h2><p id="approval-revision"></p><p data-copy="approvalScope">${copy.approvalScope}</p><div class="row"><button id="cancel-approve" data-copy="cancel">${copy.cancel}</button><button id="confirm-approve" class="primary" data-copy="approveAction">${copy.approveAction}</button></div></dialog><dialog id="variant-dialog" class="action-dialog" aria-labelledby="variant-heading"><form id="variant-form"><h2 id="variant-heading" data-copy="addVariant">${copy.addVariant}</h2><p data-copy="variantHint">${copy.variantHint}</p><label><span data-copy="variantPrompt">${copy.variantPrompt}</span><textarea id="variant-prompt" required></textarea></label><div class="row"><button type="button" id="cancel-variant" data-copy="cancel">${copy.cancel}</button><button type="submit" id="request-variant" class="primary" data-copy="requestVariant">${copy.requestVariant}</button></div></form></dialog><div id="status" role="status" aria-live="polite"></div>`

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
        !state.revision || (!!state.design?.ended && !["html", "audit", "gif", "compare"].includes(id))
    element<HTMLButtonElement>("approve").disabled ||= state.revision !== state.design?.revision
    element<HTMLButtonElement>("confirm-approve").disabled ||=
      !state.revision || state.revision !== state.design?.revision || !!state.design?.ended
    element<HTMLButtonElement>("send").disabled =
      state.working || !state.revision || (!!state.design?.ended && !state.pending)
    input("note").disabled ||= !!state.pending
    input("variant-prompt").disabled ||= !!state.variantPending
    for (const id of ["add", "attachment", "queue", "end"])
      input(id).disabled ||= !!state.pending || !!state.design?.ended
    for (const id of ["view-single", "view-compare", "peer-variant"]) input(id).disabled ||= state.variants.length < 2
  }
  const selectVariant = (id: string) => {
    if (state.working) return
    state.variant = id
    element("target").textContent = ""
    input("selection").value = ""
    state.snapshot = ""
    drawVariants()
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
    element("peer-pane").hidden = !state.comparing
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
  const tabs = ["review", "assets", "details"] as const
  const selectTab = (name: (typeof tabs)[number]) => {
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

  const save = () => {
    if (!state.design) return
    try {
      localStorage.setItem(
        key(),
        JSON.stringify({
          notes: state.notes,
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
        row.textContent = `${note.target}: ${note.text}`
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
  const chooseRevision = async (revisionID: string) => {
    const revision = await api<Design.Revision[]>(`/${state.design!.id}/revision`).then((items) =>
      items.find((item) => item.id === revisionID),
    )
    if (!revision) return
    const response = await request(`${endpoint}/${state.design!.id}/revision/${revisionID}/preview`, {
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(copy.failure)
    const html = await response.text()
    if (state.revision) save()
    if (state.revision !== revisionID) {
      state.variant = ""
      state.peer = ""
    }
    state.revision = revisionID
    restoreDraft()
    state.html = html
    state.variants = []
    element<HTMLIFrameElement>("peer-preview").removeAttribute("srcdoc")
    element<HTMLIFrameElement>("preview").srcdoc = html
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
  }
  const refresh = async (designID = state.design?.id) => {
    const documents = await api<Design.Info[]>()
    element("designs").innerHTML = documents
      .map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`)
      .join("")
    const current = documents.find((item) => item.id === designID) ?? documents.at(-1)
    if (!current) return
    const changed = state.design?.id !== current.id
    if (changed) {
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
    if (current.revision && (changed || !state.revision)) await chooseRevision(current.revision)
    input("revisions").value = state.revision
    element("newer").hidden = current.revision === state.revision
    drawSources(revisions.find((revision) => revision.id === state.revision))
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
    await refresh()
    if (state.revision) await chooseRevision(state.revision)
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
    element("approval-revision").textContent = `${state.design?.name} · ${state.revisionInfo?.name}`
    element<HTMLDialogElement>("approve-dialog").showModal()
    element("cancel-approve").focus()
  })
  element("cancel-approve").onclick = () => element<HTMLDialogElement>("approve-dialog").close()
  click("confirm-approve", async () => {
    await api(`/${state.design!.id}/approve`, "POST", { revision: state.revision })
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
    state.notes.push({
      target: element("target").textContent || "page",
      text: [input("note").value, input("selection").value].filter(Boolean).join("\n"),
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
      text: input("note").value.trim() || state.notes.map((note) => note.text).join("\n"),
      items: [
        ...state.notes,
        ...(state.variant && input("note").value.trim()
          ? [{ target: `variant:${state.variant}`, text: input("note").value.trim() }]
          : []),
      ],
      assets: [...state.assets],
      snapshot: state.snapshot,
      whiteboards: [...state.boards],
      delivery: input("queue").checked ? "queue" : "steer",
      end: input("end").checked,
    }
    save()
    drawNotes()
    await api(`/${state.design!.id}/feedback`, "POST", state.pending)
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
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
      { type: "design:annotate", enabled: input("annotate").checked },
      "*",
    )
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage({ type: "design:variant", id: state.variant }, "*")
  }
  element("annotate").onchange = () => {
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
    save()
  }
  window.addEventListener("message", message)
  const timer = setInterval(() => {
    if (!state.loading && !state.working && !state.creating && !document.hidden && !root.querySelector("dialog[open]"))
      void run(refresh, undefined, true)
  }, 5000)
  void run(refresh)
  const dispose = () => {
    save()
    state.stopped = true
    controller.abort()
    thumbnails.forEach((url) => URL.revokeObjectURL(url))
    thumbnails.clear()
    clearInterval(timer)
    window.removeEventListener("message", message)
    root.replaceChildren()
  }
  return Object.assign(dispose, {
    updateCopy(next: ReviewCopy) {
      if (state.stopped) return
      Object.assign(copy, next)
      root.querySelectorAll<HTMLElement>("[data-copy]").forEach((node) => {
        node.textContent = copy[node.dataset.copy as keyof ReviewCopy] + (node.dataset.copySuffix ?? "")
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

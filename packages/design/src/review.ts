import type { Design } from "@reddb-io/redcode-schema/design"
import type { ReviewCopy } from "./copy"

export interface ReviewOptions {
  base: string
  endpoint?: string
  sessionID: string
  copy: ReviewCopy
  appearance?: { css: string; favicon: string }
  request?: (url: string, init?: RequestInit) => Promise<Response>
  /**
   * Where the review's single-key shortcuts listen. "global" (the standalone page, where the review is
   * the whole page) also takes keys pressed with nothing focused; "scoped" (a review embedded next to
   * other inputs) only takes keys pressed while focus is inside the review.
   */
  shortcuts?: "global" | "scoped"
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
  // The hints name the modifier the reader actually presses.
  const platformize = () => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) return
    copy.cardHint = copy.cardHint.replaceAll("Ctrl", "⌘")
    copy.sendHint = copy.sendHint.replaceAll("Ctrl", "⌘")
  }
  platformize()
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
    /** A revision the reader picked whose load is still queued behind another task, such as a poll. */
    choice: "",
    failedPreview: "",
    revisionInfo: undefined as Design.Revision | undefined,
    audits: [] as Design.Job[],
    notes: [] as Design.Feedback["items"][number][],
    params: {} as Design.ParamValues,
    component: "",
    preset: "",
    assets: [] as string[],
    snapshot: "",
    /** One element picked in a preview frame and the note being written for it. */
    card: undefined as
      | {
          frame: "preview" | "peer-preview"
          target: string
          tag: string
          elementText: string
          selectedText: string
          label: string
          rect: { x: number; y: number; width: number; height: number }
          text: string
        }
      | undefined,
    /** Ticked observations; a re-audit redraw must not lose them. */
    picked: [] as string[],
    inbox: [] as {
      id: string
      target: string
      tag: string
      label: string
      severity: "warn" | "info"
      text: string
      status: "open" | "queued" | "resolved" | "dismissed"
      revision: string
    }[],
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
    /**
     * A variant operation sent to the agent and shown provisionally on the revision it was issued
     * against, until a newer revision replaces it or the request fails.
     */
    pendingOperation: undefined as
      | {
          feedback: Design.Feedback & { action: Design.VariantOperation }
          /** The variants and selection before the provisional change, to revert to. */
          variants: { id: string; name: string }[]
          variant: string
          phase: "sending" | "applying"
          working?: boolean
          published?: string
          failure?: string
        }
      | undefined,
    /** An operation whose newer revision arrived; it fails if that revision left it undone once the agent is idle. */
    operationCheck: undefined as
      | {
          action: Design.VariantOperation
          revision: string
          variants: { id: string; name: string }[]
          working: boolean
          unchanged: boolean
        }
      | undefined,
    /** The operation last requested, kept for a retry until the agent's revision carries it. */
    operationDraft: undefined as Design.VariantOperation | undefined,
    /** The operation the dialog is composing. */
    composing: undefined as { kind: Design.VariantOperationKind; variants: string[] } | undefined,
    merging: false,
    mergePick: [] as string[],
    /** Where notes on a variant merged away go by default: removed id to kept id. */
    retarget: {} as Record<string, string>,
    agent: "" as "" | "working" | "idle",
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
  const dismissedKey = () => `redcode:design:${endpoint}:${state.design?.id}:dismissed`
  const box = (value: unknown) =>
    !!value &&
    typeof value === "object" &&
    ["x", "y", "width", "height"].every((name) => Number.isFinite((value as Record<string, unknown>)[name]))
      ? {
          x: (value as { x: number }).x,
          y: (value as { y: number }).y,
          width: (value as { width: number }).width,
          height: (value as { height: number }).height,
        }
      : undefined
  const hash = (value: string) =>
    [...value].reduce((sum, char) => Math.imul(sum ^ char.codePointAt(0)!, 16777619) >>> 0, 2166136261).toString(16)
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
  const icon = (body: string) =>
    `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  const icons = {
    refresh: icon('<path d="M13.2 8.6A5.3 5.3 0 1 1 12 4.3"/><path d="M12.6 1.9v3h-3"/>'),
    more: icon('<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/>'),
    add: icon('<path d="M8 3.2v9.6M3.2 8h9.6"/>'),
    annotate: icon('<path d="M10.6 2.6l2.8 2.8-7.7 7.7-3.4.6.6-3.4z"/><path d="M9 4.2l2.8 2.8"/>'),
    edit: icon('<path d="M10.6 2.8l2.6 2.6-7.5 7.5-3.3.7.7-3.3z"/><path d="M9.2 4.2l2.6 2.6"/>'),
    single: icon('<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.5"/>'),
    compare: icon(
      '<rect x="1.7" y="3.2" width="5.4" height="9.6" rx="1.3"/><rect x="8.9" y="3.2" width="5.4" height="9.6" rx="1.3"/>',
    ),
  }
  root.innerHTML = `<style>${options.appearance?.css ?? ""}</style><style>
:host(:focus){outline:none}:host{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color-scheme:light dark;--surface:var(--reddb-color-background);--panel:var(--reddb-color-elevation-raised-surface);--canvas:var(--reddb-color-elevation-sunken-surface);--ink:var(--reddb-color-foreground);--muted:var(--reddb-color-ink-muted);--edge:var(--reddb-color-elevation-base-border);--accent:var(--reddb-color-primary);--accent-ink:var(--reddb-color-on-primary);background:var(--surface);color:var(--ink);font:13px/1.5 var(--reddb-font-family-sans,system-ui)}
*{box-sizing:border-box}[hidden]{display:none!important}button,input,select,textarea{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);padding:var(--reddb-spatial-gap-md) var(--reddb-spatial-inset-sm);min-height:var(--reddb-spatial-control-height-md);min-width:0}button{cursor:pointer;line-height:18px;transition:background-color var(--reddb-duration-fast) ease,border-color var(--reddb-duration-fast) ease}button:hover{background:var(--panel);border-color:var(--muted)}button:active{background:var(--canvas)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled{opacity:.45;cursor:default}.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}.primary:hover{background:color-mix(in oklch,var(--accent) 88%,var(--ink));border-color:var(--accent)}
header{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--edge);flex:none;min-width:0}#toolbar{flex-wrap:wrap;gap:6px;padding:5px 12px;background:var(--panel)}#toolbar :is(button,select):not(.icon){padding-top:3px;padding-bottom:3px;min-height:28px}h1{font-size:13px;letter-spacing:-.02em;margin:0 6px 0 0;display:flex;align-items:center;gap:6px;white-space:nowrap}h1 img{width:18px;height:18px;display:block}h2{font-size:15px;letter-spacing:-.015em;margin:0 0 12px}#toolbar select{width:auto;max-width:220px;flex:0 1 200px;min-width:0}.tools{display:contents}.actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;flex:0 1 auto;min-width:0;margin-left:auto}.spacer{flex:1 1 0;min-width:8px}#toolbar #width{flex:0 0 auto;width:auto;max-width:130px}#restore{border-color:transparent;background:transparent;color:var(--muted)}#approve,#reopen,#newer,#restore{white-space:nowrap}#toolbar #annotate{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap;padding-inline:8px 10px;color:var(--muted)}#annotate svg{display:block;flex:none}#annotate:hover{color:var(--ink)}#annotate[aria-pressed=true]{background:color-mix(in oklch,var(--accent) 16%,var(--surface));border-color:var(--accent);color:var(--ink);font-weight:600}.icon{width:28px;height:28px;min-height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:none;background:transparent;color:var(--muted)}.icon:hover{color:var(--ink)}.icon svg{display:block}.menu-host{position:relative;flex:none;display:flex}#menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:200px;padding:4px;display:grid;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);box-shadow:0 8px 28px color-mix(in oklch,var(--ink) 18%,transparent)}#toolbar #menu button{border:0;background:transparent;text-align:left;border-radius:4px;padding:6px 10px;min-height:0;white-space:nowrap}#toolbar #menu button:hover,#toolbar #menu button:focus-visible{background:var(--panel);outline-offset:-2px}
#studio{flex:1;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr)}main{min-height:0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 336px;overflow:hidden}.canvas{background:var(--canvas);overflow:auto;min-height:0;min-width:0;padding:24px}iframe{display:block;background:oklch(99% .002 220);border:0;height:100%;min-height:0;width:100%;margin:0 auto;box-shadow:0 0 0 1px var(--edge),0 6px 24px color-mix(in oklch,var(--ink) 7%,transparent)}aside{min-height:0;min-width:0;border-left:1px solid var(--edge);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}.tabs{display:flex;padding:0 16px;border-bottom:1px solid var(--edge);gap:18px}.tabs button{border:0;border-radius:0;background:none;padding:13px 0;color:var(--muted);position:relative}.tabs button[aria-selected=true]{color:var(--ink);font-weight:600}.tabs button[aria-selected=true]::after{content:"";position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--accent)}.panel{overflow:auto;min-height:0;padding:20px}.panel>p{margin:0 0 16px}.section{margin-top:24px;padding-top:18px;border-top:1px solid var(--edge)}label{display:grid;gap:6px;margin-bottom:14px;font-size:12px;font-weight:500}label input,label select,label textarea{font-size:13px;font-weight:400}textarea{min-height:96px;resize:vertical;width:100%;line-height:1.55}input:not([type=checkbox]),select{max-width:100%;width:100%}input[type=checkbox]{accent-color:var(--accent);margin:0}label.check{display:flex;align-items:center;gap:8px;font-weight:400}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1;min-width:0}#note{min-height:116px}#send{width:100%;margin:14px 0 8px}#add{margin-bottom:14px}#attachment{font-size:11px;padding:6px;width:100%}#attachment::file-selector-button{font:inherit;border:0;border-radius:3px;padding:4px 7px;margin-right:8px;background:var(--panel);color:var(--ink);cursor:pointer}
details{border-top:1px solid var(--edge);padding:14px 0}summary{cursor:pointer;font-weight:600;list-style-position:inside;color:var(--ink);margin-bottom:0}details[open]>summary{margin-bottom:14px}details:last-child{padding-bottom:0}.note{padding:10px 0;border-bottom:1px solid var(--edge);overflow-wrap:anywhere}.note button{float:right;padding:2px 7px;font-size:11px}.muted,small{font-size:12px;color:var(--muted);font-weight:400}small{display:block}#draft{margin-bottom:12px}#target{overflow-wrap:anywhere;background:var(--panel);font:11px/1.5 ui-monospace,monospace;padding:7px 9px;border-radius:4px;margin:12px 0}#target:empty{display:none}#notes:empty{display:none}#notes{margin-bottom:16px}#status{flex:none;min-height:28px;padding:5px 16px;border-top:1px solid var(--edge);font-size:11px;color:var(--muted)}#status:empty{display:none}#newer{color:var(--accent)}.asset{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--edge)}.asset img{width:48px;height:48px;object-fit:contain;background:var(--panel);border-radius:4px}#jobs .note{display:grid;gap:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#source-files{font-size:12px;overflow-wrap:anywhere}#html,#audit,#compare,#gif{margin-bottom:12px}#intake{flex:1;overflow:auto}form.intake{max-width:600px;margin:32px auto;padding:24px}form.intake h2{font-size:24px;margin-bottom:24px}#board-dialog{padding:12px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}#board-dialog::backdrop{background:color-mix(in oklch,var(--canvas) 70%,transparent)}#board-close{margin-bottom:12px}#board-frame{box-shadow:none}.canvas:has(iframe[src="about:blank"])::before{content:attr(data-empty);display:block;color:var(--muted);text-align:center;padding:24px}
@container(max-width:860px){#toolbar{padding:4px 10px}#toolbar #annotate{width:28px;padding:0;justify-content:center}#annotate .label{display:none}h1{margin-right:2px}#toolbar select{flex:1 1 140px;max-width:200px}#restore{font-size:0;width:28px;height:28px;flex:none;padding:0}#restore::before{content:"↶";font-size:18px}main{grid-template-columns:minmax(0,1fr) 300px}.canvas{padding:16px}.panel{padding:16px}}
@container(max-width:640px){:host{min-height:0}#toolbar select{flex:1 1 120px;max-width:none}#toolbar #width{flex:0 1 84px;max-width:84px}#approve,#reopen{font-size:12px;padding-left:8px;padding-right:8px}main{display:grid;grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(220px,.85fr)}.canvas{padding:12px}aside{border-left:0;border-top:1px solid var(--edge)}.tabs{gap:24px}.tabs button{padding:10px 0}.panel{padding:16px}form.intake{margin:0;padding:20px}}
.variant-bar{display:flex;align-items:center;gap:6px;padding:0 12px;border-bottom:1px solid var(--edge);min-width:0;min-height:31px}.variant-bar .tabs{border:0;padding:0;flex:0 1 auto;min-width:0;overflow:auto;gap:14px}.variant-bar .tabs button{white-space:nowrap;padding:6px 0;font-size:12px}#no-variants{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.variant-bar .icon{width:24px;height:24px;min-height:24px}.variant-bar .icon[aria-pressed=true]{background:var(--panel);border-color:var(--accent);color:var(--accent)}.segment{display:inline-flex;gap:2px;flex:none}.canvas{display:flex;gap:20px;padding:16px}.preview-pane{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%}.viewport{flex:1;min-height:0;overflow:auto;padding:1px}.viewport iframe{height:100%;min-height:150px}.pane-label{height:38px;flex:none;font-size:12px;display:flex;align-items:center;gap:8px;margin:0;padding-bottom:6px}.pane-label select{width:auto;flex:1;padding:4px 8px}.canvas[data-comparing=true] .preview-pane{min-width:280px}.action-dialog{width:min(520px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:24px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}.action-dialog::backdrop{background:#0008}.action-dialog p{overflow-wrap:anywhere}.action-dialog .row{justify-content:flex-end}.action-dialog .row>*{flex:0 1 auto}#status{font-size:13px;min-height:38px;padding:9px 16px;background:var(--panel);border-bottom:1px solid var(--edge);border-top:0;color:var(--ink)}#status[data-tone=error]{color:var(--reddb-color-feedback-danger-foreground)}#status[data-tone=success]{color:var(--reddb-color-feedback-success-foreground)}button[aria-busy=true]{opacity:1;cursor:progress}button[aria-busy=true]::before{content:"";display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.preview-pane[aria-busy=true] .viewport{opacity:.5}@container(max-width:640px){.variant-bar{padding:0 10px}.canvas{padding:12px;gap:12px}}
@media(prefers-reduced-motion:reduce){button{transition:none}button[aria-busy=true]::before{animation:none}}
#agent-state{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid var(--edge);color:var(--muted);white-space:nowrap}#agent-state[data-state=idle]{display:none}#agent-state[data-state=working]{color:var(--accent);border-color:var(--accent)}#agent-state[data-state=working]::before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-1px;animation:spin .8s linear infinite}#agent-state[data-state=published]{color:var(--reddb-color-feedback-success-foreground);border-color:currentColor}#feed{display:grid;gap:8px;margin-bottom:16px;max-height:40vh;overflow:auto}#feed:not(:has(.entry)) #feed-empty{display:block}#feed-empty{margin:0}#feed:has(.entry) #feed-empty{display:none}.entry{padding:8px 10px;border-radius:var(--reddb-radius-md);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5}.entry[data-kind=user]{background:color-mix(in oklch,var(--accent) 10%,var(--panel))}.entry[data-kind=tool]{font:11px/1.5 ui-monospace,monospace;color:var(--muted);padding:4px 10px;background:transparent}.entry[data-kind=published]{color:var(--reddb-color-feedback-success-foreground);font-weight:600}
.viewport{position:relative}#card{position:absolute;z-index:2;width:min(320px,100%);padding:10px 12px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);box-shadow:0 8px 28px color-mix(in oklch,var(--ink) 18%,transparent);display:grid;gap:8px}#card header{padding:0;border:0;gap:8px;font-size:12px;font-weight:600;overflow-wrap:anywhere}#card header span{flex:1;min-width:0}#card-close{flex:none;padding:0 6px;min-height:24px;font-size:14px;line-height:1}#card-text{min-height:64px;width:100%;resize:vertical}#card .row{justify-content:flex-end}#card .row>*{flex:0 1 auto}#card small{font-size:11px}#card.moved header{animation:card-moved .6s ease-out 2}@keyframes card-moved{50%{color:var(--accent)}}
.note{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}.note .note-label{font-weight:600;font-size:12px}.note .note-text{flex:1 1 100%;white-space:pre-wrap}.note button{float:none;margin-left:auto;padding:2px 7px;font-size:11px}.note button+button{margin-left:0}.note:hover{background:color-mix(in oklch,var(--panel) 60%,transparent)}
.sends{display:flex;gap:8px;margin:14px 0 8px}.sends>*{flex:1;min-width:0}#send{width:auto;margin:0}#send-end{white-space:nowrap}#send-hint{margin-bottom:8px}
#inbox{margin-top:8px}#inbox summary{display:flex;align-items:center;gap:8px}#inbox-count{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--panel);border:1px solid var(--edge);color:var(--muted)}#inbox-count[data-open="true"]{color:var(--accent-ink);background:var(--accent);border-color:var(--accent)}.finding{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px;padding:8px 0;border-bottom:1px solid var(--edge);font-size:12px;overflow-wrap:anywhere}.finding input{margin-top:3px}.finding .finding-tag{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;border:1px solid var(--edge);color:var(--muted);align-self:start;margin-top:2px}.finding[data-severity=warn] .finding-tag{color:var(--reddb-color-feedback-danger-foreground);border-color:currentColor}.finding[data-status=resolved]{color:var(--muted)}.finding .finding-body{display:grid;gap:2px}.finding .finding-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}.finding .finding-actions button{padding:2px 7px;font-size:11px}.finding .finding-status{font-size:11px;color:var(--muted)}#queue-fixes{margin-top:10px}#inbox-empty{margin:6px 0 0}
#variant-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:200px;padding:4px;display:grid;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);box-shadow:0 8px 28px color-mix(in oklch,var(--ink) 18%,transparent)}#variant-menu button{border:0;background:transparent;text-align:left;border-radius:4px;padding:6px 10px;min-height:0;white-space:nowrap;font-size:12px}#variant-menu button:hover,#variant-menu button:focus-visible{background:var(--panel);outline-offset:-2px}.op-badge{margin-left:6px;font-size:10px;font-weight:600;line-height:16px;padding:0 6px;border-radius:999px;border:1px solid currentColor;color:var(--accent);white-space:nowrap}.variant-bar .tabs button[data-operation]{color:var(--accent)}#merge-bar{display:flex;align-items:center;gap:10px;min-width:0;overflow:auto;font-size:12px}#merge-options{display:flex;gap:10px}#merge-bar label{margin:0;display:flex;gap:6px;align-items:center;font-weight:400;white-space:nowrap}#merge-bar button{min-height:24px;padding:1px 8px;font-size:12px;white-space:nowrap}#operation-state{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;margin:0 0 12px;border-radius:var(--reddb-radius-md);background:var(--panel);color:var(--reddb-color-feedback-danger-foreground);overflow-wrap:anywhere}#operation-state button{padding:2px 8px;font-size:12px;color:var(--ink)}.note .note-orphaned{font-size:10px;font-weight:600;padding:0 6px;border-radius:4px;border:1px solid currentColor;color:var(--reddb-color-feedback-danger-foreground)}#approval-reselect{color:var(--reddb-color-feedback-danger-foreground)}
    </style><header id="toolbar"><h1>${options.appearance ? `<img src="${options.appearance.favicon}" alt="RedDB">` : ""}<span data-copy="title">${copy.title}</span></h1><select id="designs" aria-label="${copy.alternatives}" data-copy-aria-label="alternatives"></select><div id="revision-tools" class="tools" hidden><select id="revisions" aria-label="${copy.history}" data-copy-aria-label="history"></select><button id="newer" hidden><span data-copy="latest">${copy.latest}</span></button><span id="agent-state" hidden data-state="idle" data-copy="stateIdle">${copy.stateIdle}</span></div><div class="actions"><div id="review-tools" class="tools" hidden><button type="button" id="annotate" aria-pressed="false" aria-label="${copy.annotate}" data-copy-aria-label="annotate" title="${copy.annotateShortcut}" data-copy-title="annotateShortcut">${icons.annotate}<span class="label" data-copy="annotateShort">${copy.annotateShort}</span></button><select id="width" aria-label="${copy.width}" data-copy-aria-label="width"><option value="100%" data-copy="full">${copy.full}</option><option value="390" data-copy="mobile">${copy.mobile}</option><option value="768" data-copy="tablet">${copy.tablet}</option><option value="1440" data-copy="desktop">${copy.desktop}</option></select><button id="restore" hidden title="${copy.restore}" data-copy-title="restore" aria-label="${copy.restore}" data-copy-aria-label="restore"><span data-copy="restore">${copy.restore}</span></button><button id="approve" class="primary"><span data-copy="approve">${copy.approve}</span></button><button id="reopen" hidden><span data-copy="reopen">${copy.reopen}</span></button></div><button type="button" id="refresh" class="icon" aria-label="${copy.refresh}" data-copy-aria-label="refresh" title="${copy.refresh}" data-copy-title="refresh">${icons.refresh}</button><div class="menu-host" id="menu-host"><button type="button" id="more" class="icon" aria-label="${copy.more}" data-copy-aria-label="more" title="${copy.more}" data-copy-title="more" aria-haspopup="menu" aria-expanded="false" aria-controls="menu">${icons.more}</button><div id="menu" role="menu" aria-label="${copy.more}" data-copy-aria-label="more" hidden><button type="button" role="menuitem" id="new"><span data-copy="create">${copy.create}</span></button><button type="button" role="menuitem" id="menu-refresh" data-for="refresh"><span data-copy="refresh">${copy.refresh}</span></button><button type="button" role="menuitem" id="menu-add-variant" data-for="add-variant"><span data-copy="addVariant">${copy.addVariant}</span></button><button type="button" role="menuitem" id="organize-variants"><span data-copy="organizeVariants">${copy.organizeVariants}</span></button></div></div></div></header>
    <section id="intake"><form class="intake" id="create"><h2><span data-copy="create">${copy.create}</span></h2><label><span data-copy="name">${copy.name}</span><input id="name" required></label><div class="row"><label><span data-copy="journey">${copy.journey}</span><select id="journey"><option value="new" data-copy="new">${copy.new}</option><option value="existing" data-copy="existing">${copy.existing}</option></select></label><label><span data-copy="engine">${copy.engine}</span><select id="engine"><option value="html">HTML</option><option value="react">React</option><option value="solid">Solid</option></select></label></div><label><span data-copy="application">${copy.application}</span><input id="application" value="."></label><label><span data-copy="objective">${copy.objective}</span><textarea id="objective" required></textarea></label><label><span data-copy="audience">${copy.audience}</span><input id="audience"></label><label><span data-copy="constraints">${copy.constraints}</span><textarea id="constraints"></textarea></label><label><span data-copy="references">${copy.references}</span><textarea id="references"></textarea></label><button class="primary"><span data-copy="create">${copy.create}</span></button></form></section>
    <section id="studio" hidden><div class="variant-bar"><div id="variants" class="tabs" role="tablist" aria-label="${copy.variants}" data-copy-aria-label="variants"></div><span id="no-variants" class="muted" data-copy="noVariants">${copy.noVariants}</span><div id="merge-bar" role="group" aria-label="${copy.mergeSelection}" data-copy-aria-label="mergeSelection" hidden><span id="merge-options"></span><button type="button" id="merge-variants" class="primary"><span data-copy="mergeVariants">${copy.mergeVariants}</span></button><button type="button" id="cancel-merge"><span data-copy="cancel">${copy.cancel}</span></button></div><span id="operation-badge" class="op-badge" role="status" hidden></span><span class="spacer"></span><button type="button" id="add-variant" class="icon" aria-label="${copy.addVariant}" data-copy-aria-label="addVariant" title="${copy.addVariant}" data-copy-title="addVariant">${icons.add}</button><div class="menu-host" id="variant-menu-host"><button type="button" id="variant-actions" class="icon" aria-label="${copy.variantActions}" data-copy-aria-label="variantActions" title="${copy.variantActions}" data-copy-title="variantActions" aria-haspopup="menu" aria-expanded="false" aria-controls="variant-menu" hidden>${icons.edit}</button><div id="variant-menu" role="menu" aria-label="${copy.variantActions}" data-copy-aria-label="variantActions" hidden><button type="button" role="menuitem" id="rename-variant"><span data-copy="renameVariant">${copy.renameVariant}</span></button><button type="button" role="menuitem" id="split-variant"><span data-copy="splitVariant">${copy.splitVariant}</span></button><button type="button" role="menuitem" id="delete-variant"><span data-copy="deleteVariant">${copy.deleteVariant}</span></button><button type="button" role="menuitem" id="move-left"><span data-copy="moveLeft">${copy.moveLeft}</span></button><button type="button" role="menuitem" id="move-right"><span data-copy="moveRight">${copy.moveRight}</span></button><button type="button" role="menuitem" id="select-merge"><span data-copy="selectMerge">${copy.selectMerge}</span></button><button type="button" role="menuitem" id="menu-newer" data-for="newer"><span data-copy="latest">${copy.latest}</span></button><button type="button" role="menuitem" id="menu-reopen" data-for="reopen"><span data-copy="reopen">${copy.reopen}</span></button></div></div><span class="segment"><button type="button" id="view-single" class="icon" aria-pressed="true" aria-label="${copy.single}" data-copy-aria-label="single" title="${copy.single}" data-copy-title="single">${icons.single}</button><button type="button" id="view-compare" class="icon" aria-pressed="false" aria-label="${copy.sideBySide}" data-copy-aria-label="sideBySide" title="${copy.sideBySide}" data-copy-title="sideBySide">${icons.compare}</button></span></div><main><div class="canvas" id="canvas"><p id="preview-error" role="alert" hidden style="white-space:pre-wrap;overflow-wrap:anywhere"></p><section class="preview-pane" id="primary-pane" role="tabpanel"><div class="pane-label" id="primary-label" hidden></div><div class="viewport"><iframe id="preview" title="${copy.review}" data-copy-title="review" sandbox="allow-scripts allow-forms" allow=""></iframe><div id="card" hidden role="dialog" aria-labelledby="card-label"><header><span id="card-label"></span><button type="button" id="card-close" aria-label="${copy.closeCard}" data-copy-aria-label="closeCard" title="${copy.closeCard}" data-copy-title="closeCard">×</button></header><textarea id="card-text" aria-label="${copy.cardNote}" data-copy-aria-label="cardNote"></textarea><small class="muted" data-copy="cardHint">${copy.cardHint}</small><div class="row"><button type="button" id="card-add" class="primary"><span data-copy="add">${copy.add}</span></button></div></div></div></section><section class="preview-pane" id="peer-pane" hidden><label class="pane-label"><span data-copy="compareVariant">${copy.compareVariant}</span><select id="peer-variant"></select></label><div class="viewport"><iframe id="peer-preview" title="${copy.compareVariant}" data-copy-title="compareVariant" sandbox="allow-scripts allow-forms" allow=""></iframe></div></section></div><aside><div class="tabs" role="tablist" aria-label="${copy.review}"><button type="button" role="tab" id="tab-review" aria-controls="panel-review" aria-selected="true" tabindex="0"><span data-copy="conversation">${copy.conversation}</span></button><button type="button" role="tab" id="tab-assets" aria-controls="panel-assets" aria-selected="false" tabindex="-1"><span data-copy="assets">${copy.assets}</span></button><button type="button" role="tab" id="tab-details" aria-controls="panel-details" aria-selected="false" tabindex="-1"><span data-copy="details">${copy.details}</span></button><button type="button" role="tab" id="tab-params" aria-controls="panel-params" aria-selected="false" tabindex="-1"><span data-copy="params">${copy.params}</span></button></div><section class="panel" role="tabpanel" id="panel-review" aria-labelledby="tab-review"><h2><span data-copy="conversation">${copy.conversation}</span></h2><p id="review-state" class="muted"></p><div id="operation-state" role="alert" hidden><span id="operation-error"></span><button type="button" id="retry-operation"><span data-copy="operationRetry">${copy.operationRetry}</span></button></div><p id="approval-reselect" data-copy="approvalReselect" hidden>${copy.approvalReselect}</p><div id="feed" role="log" aria-live="polite" hidden><p id="feed-empty" class="muted" data-copy="feedEmpty">${copy.feedEmpty}</p></div><details id="approved-record" hidden><summary data-copy="approvalDetails">${copy.approvalDetails}</summary><pre id="approved-details"></pre></details><p class="muted"><span data-copy="inspect">${copy.inspect}</span></p><small id="target" hidden></small><div id="notes"></div><details id="inbox"><summary><span data-copy="findings">${copy.findings}</span><span id="inbox-count" data-open="false">0</span></summary><p id="inbox-empty" class="muted" data-copy="inboxEmpty">${copy.inboxEmpty}</p><div id="inbox-list"></div><button type="button" id="queue-fixes" hidden><span data-copy="queueFixes">${copy.queueFixes}</span></button></details><label><span data-copy="notes">${copy.notes}</span><textarea id="note"></textarea></label><label><span data-copy="attachment">${copy.attachment}</span><input id="attachment" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"></label><small id="draft"><span data-copy="draft">${copy.draft}</span></small><small id="send-hint" class="muted" data-copy="sendHint">${copy.sendHint}</small><div class="sends"><button id="send" class="primary"><span data-copy="send">${copy.send}</span></button><button id="send-end"><span data-copy="sendEnd">${copy.sendEnd}</span></button></div>
    <details><summary><span data-copy="diagram">${copy.diagram}</span></summary><label><span data-copy="diagram">${copy.diagram}</span><textarea id="selection"></textarea></label><button type="button" id="whiteboard"><span data-copy="whiteboard">${copy.whiteboard}</span></button></details></section><section class="panel" role="tabpanel" id="panel-assets" aria-labelledby="tab-assets" hidden><details open><summary><span data-copy="assets">${copy.assets}</span></summary><div id="assets"></div></details><details open><summary><span data-copy="export">${copy.export}</span></summary><button id="html"><span data-copy="html">${copy.html}</span></button><button id="audit"><span data-copy="audit">${copy.audit}</span></button><label><span data-copy="implementation">${copy.implementation}</span><input id="implementation" value="dist"></label><button id="compare"><span data-copy="compare">${copy.compare}</span></button><label><span data-copy="source">${copy.source}</span><select id="svg"></select></label><div class="row"><label><span data-copy="duration">${copy.duration}</span><input id="duration" type="number" min="0.1" max="10" step="0.1" value="3"></label><label><span data-copy="fps">${copy.fps}</span><input id="fps" type="number" min="1" max="25" value="20"></label></div><label><span data-copy="size">${copy.size}</span><input id="size" type="number" min="16" max="1024" value="512"></label><label class="check"><input type="checkbox" id="transparent"><span data-copy="transparent">${copy.transparent}</span></label><button id="gif"><span data-copy="gif">${copy.gif}</span></button></details><details open><summary><span data-copy="jobs">${copy.jobs}</span></summary><div id="jobs"></div></details>
    </section><section class="panel" role="tabpanel" id="panel-details" aria-labelledby="tab-details" hidden>
    <details><summary><span data-copy="system">${copy.system}</span></summary><div id="source-files"></div><button id="refresh-system"><span data-copy="refreshSystem">${copy.refreshSystem}</span></button></details><details><summary><span data-copy="decisions">${copy.decisions}</span></summary><div id="decisions"></div><h2><span data-copy="questions">${copy.questions}</span></h2><div id="questions"></div><h2><span data-copy="scenarios">${copy.scenarios}</span></h2><div id="scenarios"></div></details>
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
    <p class="muted" data-copy="paramPublish">${copy.paramPublish}</p></div></div></section></aside></main></section><dialog id="board-dialog" style="width:95vw;height:90vh;max-width:1400px"><button id="board-close"><span data-copy="close">${copy.close}</span></button><iframe id="board-frame" title="${copy.whiteboard}" data-copy-title="whiteboard" sandbox="allow-scripts" style="height:calc(100% - 50px);width:100%"></iframe></dialog><dialog id="approve-dialog" class="action-dialog" aria-labelledby="approve-heading"><h2 id="approve-heading" data-copy="confirm">${copy.confirm}</h2><p id="approval-revision"></p><p data-copy="approvalScope">${copy.approvalScope}</p><div class="row"><button id="cancel-approve" data-copy="cancel">${copy.cancel}</button><button id="confirm-approve" class="primary" data-copy="approveAction">${copy.approveAction}</button></div></dialog><dialog id="variant-dialog" class="action-dialog" aria-labelledby="variant-heading"><form id="variant-form"><h2 id="variant-heading" data-copy="addVariant">${copy.addVariant}</h2><p data-copy="variantHint">${copy.variantHint}</p><label><span data-copy="variantPrompt">${copy.variantPrompt}</span><textarea id="variant-prompt" required></textarea></label><div class="row"><button type="button" id="cancel-variant" data-copy="cancel">${copy.cancel}</button><button type="submit" id="request-variant" class="primary" data-copy="requestVariant">${copy.requestVariant}</button></div></form></dialog><dialog id="operation-dialog" class="action-dialog" aria-labelledby="operation-heading"><form id="operation-form"><h2 id="operation-heading"></h2><p id="operation-subject"></p><p id="operation-hint"></p><label id="operation-name-field"><span data-copy="renameLabel">${copy.renameLabel}</span><input id="operation-name" maxlength="100"></label><label id="operation-text-field"><span data-copy="operationGuidance">${copy.operationGuidance}</span><textarea id="operation-text" maxlength="2000"></textarea></label><div class="row"><button type="button" id="cancel-operation" data-copy="cancel">${copy.cancel}</button><button type="submit" id="confirm-operation" class="primary"></button></div></form></dialog><div id="status" role="status" aria-live="polite"></div>`

  for (const id of ["approve-dialog", "variant-dialog", "operation-dialog"]) {
    const notice = document.createElement("p")
    notice.dataset.actionStatus = ""
    notice.setAttribute("role", "status")
    notice.setAttribute("aria-live", "polite")
    element(id).append(notice)
  }
  const showStudio = (visible: boolean) => {
    element("intake").hidden = visible
    element("studio").hidden = !visible
    element("revision-tools").hidden = !visible
    element("review-tools").hidden = !visible
  }
  const controls = () => {
    root
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("button, input, select, textarea")
      .forEach((control) => {
        if (
          control.id.startsWith("tab-") ||
          control.id.startsWith("cancel-") ||
          control.id === "board-close" ||
          control.id === "card-close"
        )
          return
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
    element<HTMLButtonElement>("approve").disabled ||=
      state.revision !== state.design?.revision || !!state.pendingOperation
    element<HTMLButtonElement>("confirm-approve").disabled ||=
      !state.revision ||
      !!state.failedPreview ||
      state.revision !== state.design?.revision ||
      !!state.design?.ended ||
      !!state.pendingOperation
    // Variant operations change the latest revision only, one at a time, while the review is open.
    const blocked = operationBlocked()
    const index = state.variants.findIndex((item) => item.id === state.variant)
    for (const id of ["rename-variant", "split-variant", "delete-variant", "select-merge"])
      element<HTMLButtonElement>(id).disabled = blocked || index < 0
    element<HTMLButtonElement>("move-left").disabled = blocked || index <= 0
    element<HTMLButtonElement>("move-right").disabled = blocked || index < 0 || index >= state.variants.length - 1
    element<HTMLButtonElement>("merge-variants").disabled = blocked || state.mergePick.length < 2
    element<HTMLButtonElement>("confirm-operation").disabled = blocked
    element<HTMLButtonElement>("retry-operation").disabled = blocked
    element<HTMLButtonElement>("variant-actions").disabled = state.working || !!state.failedPreview
    element("merge-options")
      .querySelectorAll("input")
      .forEach((box) => {
        box.disabled = blocked
      })
    element<HTMLButtonElement>("send").disabled =
      state.working || !state.revision || !!state.failedPreview || (!!state.design?.ended && !state.pending)
    element<HTMLButtonElement>("send-end").disabled =
      state.working || !state.revision || !!state.failedPreview || !!state.design?.ended || !!state.pending
    input("note").disabled ||= !!state.pending
    input("variant-prompt").disabled ||= !!state.variantPending
    for (const id of ["attachment", "card-text", "card-add", "queue-fixes"])
      input(id).disabled ||= !!state.pending || !!state.design?.ended
    for (const id of ["view-single", "view-compare", "peer-variant"])
      input(id).disabled ||= !!state.failedPreview || state.variants.length < 2
    element("variants")
      .querySelectorAll("button")
      .forEach((button) => {
        button.disabled ||= !!state.failedPreview
      })
    syncMenu()
  }
  // Overflow entries stand in for the icon buttons they delegate to, so they follow the same state.
  const syncMenu = () =>
    root.querySelectorAll<HTMLButtonElement>("[role=menu] [data-for]").forEach((item) => {
      const target = element<HTMLButtonElement>(item.dataset.for!)
      item.disabled = target.disabled
      item.hidden = target.hidden || (target.closest<HTMLElement>("#studio")?.hidden ?? false)
    })
  const selectVariant = (id: string) => {
    if (state.working || state.failedPreview) return
    state.variant = id
    element("target").textContent = ""
    input("selection").value = ""
    state.snapshot = ""
    if (state.card && state.card.frame === "preview" && (variantOf(state.card.target) ?? "") !== id) closeCard()
    drawVariants()
    state.preset = ""
    drawParams()
    element(`variant-${id}`).focus()
  }
  const drawVariants = () => {
    const items = state.variants
    element("no-variants").hidden = items.length > 0
    element("organize-variants").hidden = items.length > 0
    element("variant-actions").hidden = items.length === 0
    state.mergePick = state.mergePick.filter((id) => items.some((item) => item.id === id))
    state.merging &&= items.length > 1
    element("variants").hidden = state.merging
    element("merge-bar").hidden = !state.merging
    element("merge-options").replaceChildren(
      ...(state.merging ? items : []).map((item) => {
        const label = document.createElement("label")
        label.className = "check"
        const box = document.createElement("input")
        box.type = "checkbox"
        box.id = `merge-${item.id}`
        box.checked = state.mergePick.includes(item.id)
        // Ticking order is merge order: the first ticked variant keeps its id.
        box.addEventListener("change", () => {
          state.mergePick = box.checked
            ? [...state.mergePick.filter((id) => id !== item.id), item.id]
            : state.mergePick.filter((id) => id !== item.id)
          controls()
        })
        label.append(box, item.name)
        return label
      }),
    )
    const operation = state.pendingOperation?.feedback.action
    const badge = operation
      ? operation.kind === "merge"
        ? ("operationMerging" as const)
        : operation.kind === "split"
          ? ("operationSplitting" as const)
          : ("operationApplying" as const)
      : undefined
    element("operation-badge").hidden = !badge
    if (badge) {
      element("operation-badge").dataset.copy = badge
      element("operation-badge").textContent = copy[badge]
    }
    const before = state.pendingOperation?.variants ?? []
    const involved = (id: string) =>
      !!operation &&
      (operation.kind === "reorder"
        ? before.findIndex((item) => item.id === id) !== items.findIndex((item) => item.id === id)
        : operation.variants.includes(id))
    const approved = state.approval?.variant
    element("approval-reselect").hidden =
      !approved ||
      state.approval?.revision.id === state.revision ||
      !!state.design?.ended ||
      !items.length ||
      items.some((item) => item.id === approved.id)
    element("variants").replaceChildren(
      ...items.map((item, index) => {
        const button = document.createElement("button")
        button.id = `variant-${item.id}`
        button.textContent = item.name
        if (badge && involved(item.id)) {
          const mark = document.createElement("span")
          mark.className = "op-badge"
          mark.dataset.copy = badge
          mark.textContent = copy[badge]
          button.dataset.operation = operation!.kind
          button.append(mark)
        }
        button.setAttribute("role", "tab")
        button.setAttribute("aria-controls", "primary-pane")
        button.setAttribute("aria-selected", String(item.id === state.variant))
        button.tabIndex = item.id === state.variant ? 0 : -1
        // Shift-click starts choosing variants to merge, beginning with the one on screen.
        button.addEventListener("click", (event) => {
          if (!event.shiftKey) return selectVariant(item.id)
          if (operationBlocked() || item.id === state.variant) return
          state.merging = true
          state.mergePick = [...new Set([state.variant, ...state.mergePick, item.id])].filter(Boolean)
          drawVariants()
          input(`merge-${item.id}`).focus()
        })
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
    drawNotes()
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
    setAnnotate(false)
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
          card: state.card,
          inbox: state.inbox,
          pending: state.pending,
          boards: state.boards,
          board: state.board,
          variantPrompt: input("variant-prompt").value,
          variantPending: state.variantPending,
          pendingOperation: state.pendingOperation,
          operationDraft: state.operationDraft,
          retarget: state.retarget,
        }),
      )
    } catch {
      status(copy.failure, "failure")
    }
  }
  const variantOf = (target: string) => /^variant:([a-zA-Z0-9_-]{1,64}) /.exec(target)?.[1]
  const reveal = (target: string, pulse = true) => {
    const variant = variantOf(target)
    const peer = !!variant && state.comparing && variant === state.peer
    // A note taken on another variant shows that variant first; the frame only scrolls.
    if (!peer && variant && variant !== state.variant && state.variants.some((item) => item.id === variant))
      selectVariant(variant)
    element<HTMLIFrameElement>(peer ? "peer-preview" : "preview").contentWindow?.postMessage(
      { type: "design:reveal", target, pulse },
      "*",
    )
  }
  const highlight = (target: string) => {
    for (const id of ["preview", "peer-preview"])
      element<HTMLIFrameElement>(id).contentWindow?.postMessage({ type: "design:highlight", target }, "*")
  }
  const action = (name: "reveal" | "remove" | "dismiss", onclick: () => void) => {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.copy = name
    button.textContent = copy[name]
    button.onclick = onclick
    return button
  }
  const drawNotes = () => {
    element("notes").replaceChildren(
      ...state.notes.map((note, index) => {
        const row = document.createElement("div")
        row.className = "note"
        const label = document.createElement("span")
        label.className = "note-label"
        label.textContent = note.label || note.target
        const text = document.createElement("span")
        text.className = "note-text"
        text.textContent = note.text
        // A note on a variant that is gone from the revision on screen says so and offers a new home.
        const from = variantOf(note.target)
        const orphaned = !!from && state.variants.length > 0 && !state.variants.some((item) => item.id === from)
        const destination = orphaned
          ? (state.variants.find((item) => item.id === state.retarget[from!]) ??
            state.variants.find((item) => item.id === state.variant) ??
            state.variants[0])
          : undefined
        const orphan: HTMLElement[] = []
        if (orphaned && destination) {
          row.dataset.orphaned = "true"
          const mark = document.createElement("span")
          mark.className = "note-orphaned"
          mark.dataset.copy = "noteOrphaned"
          mark.textContent = copy.noteOrphaned
          const move = document.createElement("button")
          move.type = "button"
          move.dataset.copy = "retarget"
          move.dataset.copySuffix = ` ${destination.name}`
          move.textContent = `${copy.retarget} ${destination.name}`
          move.addEventListener("click", () => {
            if (state.pending) return
            state.notes[index] = {
              ...note,
              target: note.target.replace(/^variant:[a-zA-Z0-9_-]{1,64} /, `variant:${destination.id} `),
              ...(note.params ? { params: { ...note.params, variant: destination.id } } : {}),
            }
            save()
            drawNotes()
          })
          orphan.push(mark, move)
        }
        row.append(
          label,
          ...orphan,
          action("reveal", () => reveal(note.target)),
          action("remove", () => {
            if (state.pending) return
            state.notes.splice(index, 1)
            save()
            drawNotes()
          }),
          text,
        )
        row.onmouseenter = () => highlight(note.target)
        row.onmouseleave = () => highlight("")
        return row
      }),
    )
    element<HTMLButtonElement>("send").textContent = state.pending ? copy.retry : copy.send
    element("send").dataset.copy = state.pending ? "retry" : "send"
    element("send-end").hidden = !!state.pending
    input("note").disabled = !!state.pending
  }
  const dismissed = (): string[] => {
    try {
      const stored = JSON.parse(localStorage.getItem(dismissedKey()) ?? "[]")
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : []
    } catch {
      return []
    }
  }
  const drawInbox = () => {
    const open = state.inbox.filter((item) => item.status === "open")
    const shown = state.inbox.filter((item) => item.status !== "dismissed")
    element("inbox-count").textContent = String(open.length)
    element("inbox-count").dataset.open = String(open.length > 0)
    element("inbox-empty").hidden = shown.length > 0
    element("queue-fixes").hidden = open.length === 0
    element("inbox-list").replaceChildren(
      ...shown.map((item) => {
        const row = document.createElement("div")
        row.className = "finding"
        row.dataset.severity = item.severity
        row.dataset.status = item.status
        row.dataset.id = item.id
        const pick = document.createElement("input")
        pick.type = "checkbox"
        pick.setAttribute("aria-label", `${item.label}: ${item.text}`)
        pick.hidden = item.status !== "open"
        pick.checked = state.picked.includes(item.id)
        pick.onchange = () => {
          state.picked = pick.checked
            ? [...new Set([...state.picked, item.id])]
            : state.picked.filter((id) => id !== item.id)
        }
        const mark = document.createElement("span")
        mark.className = "finding-status"
        mark.dataset.copy = item.status === "queued" ? "inboxQueued" : "inboxResolved"
        mark.textContent = item.status === "queued" ? copy.inboxQueued : copy.inboxResolved
        mark.hidden = item.status === "open"
        const body = document.createElement("div")
        body.className = "finding-body"
        const head = document.createElement("div")
        const tag = document.createElement("span")
        tag.className = "finding-tag"
        tag.dataset.copy = item.severity === "warn" ? "severityWarn" : "severityInfo"
        tag.textContent = item.severity === "warn" ? copy.severityWarn : copy.severityInfo
        const label = document.createElement("strong")
        label.textContent = ` ${item.label}`
        head.append(tag, label)
        const text = document.createElement("span")
        text.textContent = item.text
        const actions = document.createElement("div")
        actions.className = "finding-actions"
        actions.append(
          action("reveal", () => reveal(item.target)),
          ...(item.status === "resolved"
            ? []
            : [
                action("dismiss", () => {
                  item.status = "dismissed"
                  try {
                    localStorage.setItem(dismissedKey(), JSON.stringify([...new Set([...dismissed(), item.id])]))
                  } catch {
                    status(copy.failure, "failure")
                  }
                  save()
                  drawInbox()
                }),
              ]),
        )
        body.append(head, text, actions)
        row.append(pick, mark, body)
        row.onmouseenter = () => highlight(item.target)
        row.onmouseleave = () => highlight("")
        return row
      }),
    )
  }
  // The frame audits every layout pass; a finding keeps its lifecycle across those passes and is
  // resolved only when a newer revision's audit no longer reports it.
  const mergeFindings = (
    findings: { target: string; tag: string; label: string; severity: "warn" | "info"; text: string }[],
  ) => {
    const hidden = new Set(dismissed())
    const seen = new Set<string>()
    const before = JSON.stringify(state.inbox)
    state.inbox = state.inbox.filter((item) => item.status !== "resolved" || item.revision === state.revision)
    for (const finding of findings) {
      const id = hash(`${finding.target}\n${finding.text}`)
      seen.add(id)
      const existing = state.inbox.find((item) => item.id === id)
      if (!existing) {
        state.inbox.push({ id, ...finding, status: hidden.has(id) ? "dismissed" : "open", revision: state.revision })
        continue
      }
      if (existing.status === "resolved" || (existing.status === "queued" && existing.revision !== state.revision))
        existing.status = "open"
      existing.revision = state.revision
    }
    for (const item of state.inbox) {
      if (seen.has(item.id) || item.revision === state.revision || item.status === "dismissed") continue
      item.status = "resolved"
      item.revision = state.revision
    }
    // The frame re-audits on every layout pass; an unchanged inbox keeps its ticks and skips the write.
    if (JSON.stringify(state.inbox) === before) return
    state.picked = state.picked.filter((id) => state.inbox.some((item) => item.id === id && item.status === "open"))
    save()
    drawInbox()
  }
  const placeCard = () => {
    const card = element("card")
    if (!state.card) {
      card.hidden = true
      return
    }
    const frame = element<HTMLIFrameElement>(state.card.frame)
    const viewport = frame.parentElement!
    if (card.parentElement !== viewport) viewport.append(card)
    card.hidden = false
    const rect = state.card.rect
    const left = Math.max(0, Math.min(frame.offsetLeft + rect.x, viewport.scrollWidth - card.offsetWidth))
    const below = frame.offsetTop + rect.y + rect.height + 8
    const above = frame.offsetTop + rect.y - card.offsetHeight - 8
    const top = below + card.offsetHeight <= viewport.scrollHeight || above < 0 ? below : above
    card.style.left = `${Math.round(left)}px`
    card.style.top = `${Math.round(Math.max(0, Math.min(top, viewport.scrollHeight - card.offsetHeight)))}px`
  }
  const drawCard = () => {
    if (state.card) {
      element("card-label").textContent = state.card.label
      if (input("card-text").value !== state.card.text) input("card-text").value = state.card.text
    }
    placeCard()
  }
  // Hands focus from the note card to the annotation toggle, or to the host when the toggle cannot take it.
  const focusToggle = () => {
    input("card-text").blur()
    element("annotate").focus({ preventScroll: true })
    if (root.activeElement !== element("annotate")) host.focus({ preventScroll: true })
  }
  const closeCard = () => {
    // Focus must not linger on the hidden field, or it keeps swallowing the review's keys; it goes to
    // the annotation toggle so A and Escape keep working without a click.
    if (root.activeElement === input("card-text")) focusToggle()
    state.card = undefined
    highlight("")
    save()
    drawCard()
  }
  const queueCard = () => {
    const card = state.card
    if (!card || state.pending || !card.text.trim()) return false
    state.notes.push({
      target: card.target,
      params: paramContext(),
      revision: state.revision,
      text: card.text.trim(),
      tag: card.tag,
      elementText: card.elementText,
      label: card.label,
      ...(card.selectedText ? { selectedText: card.selectedText } : {}),
    })
    closeCard()
    drawNotes()
    return true
  }
  // A stored card needs a usable rect and the primary frame (comparing is not persisted); anything
  // else is dropped rather than breaking the revision load.
  const restoreCard = (value: unknown): typeof state.card => {
    if (!value || typeof value !== "object") return undefined
    const card = value as Record<string, unknown>
    const rect = box(card.rect)
    const text = (name: string) => (typeof card[name] === "string" ? (card[name] as string) : "")
    if (!rect || !text("target")) return undefined
    return {
      frame: "preview",
      target: text("target"),
      tag: text("tag"),
      elementText: text("elementText"),
      selectedText: text("selectedText"),
      label: text("label") || text("tag") || "page",
      rect,
      text: text("text"),
    }
  }
  const restoreDraft = () => {
    state.notes = []
    state.params = {}
    state.component = ""
    state.preset = ""
    state.assets = []
    state.snapshot = ""
    state.card = undefined
    state.inbox = []
    state.pending = undefined
    state.boards = []
    state.board = undefined
    state.variantPending = undefined
    state.pendingOperation = undefined
    state.operationDraft = undefined
    state.retarget = {}
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
        state.card = restoreCard(stored.card)
        state.inbox = stored.inbox ?? []
        state.pending = stored.pending
        state.boards = stored.boards ?? []
        state.board = stored.board
        state.variantPending = stored.variantPending
        // A provisional change survives a reload only while its revision is still the latest one.
        state.pendingOperation =
          stored.pendingOperation?.feedback?.revision === state.revision && state.revision === state.design?.revision
            ? stored.pendingOperation
            : undefined
        state.operationDraft = stored.operationDraft
        state.retarget = stored.retarget ?? {}
        input("variant-prompt").value = stored.variantPrompt ?? ""
        input("note").value = stored.text ?? ""
      }
    } catch {
      status(copy.failure, "failure")
    }
    drawNotes()
    drawInbox()
    drawCard()
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
    const operation = state.pendingOperation
    if (event.type === "state") {
      pill(event.state === "working" ? "stateWorking" : "stateIdle")
      state.agent = event.state
      if (event.state === "working") {
        if (operation) operation.working = true
        if (state.operationCheck) state.operationCheck.working = true
        return
      }
      // The agent went idle after taking up the operation without publishing anything newer.
      if (operation?.phase === "applying" && operation.working && !operation.published)
        failOperation(operation.failure ? `${copy.operationStopped} ${operation.failure}` : copy.operationStopped)
      else if (state.operationCheck?.unchanged && state.operationCheck.working) failOperation(copy.operationUnchanged)
      return
    }
    if (event.type === "agent") return
    upsert(event)
    if (event.type === "tool" && event.status === "failed" && operation)
      operation.failure = `${event.tool}${event.summary ? `: ${event.summary}` : ""}`
    if (event.type !== "published") return
    if (operation && event.design === state.design?.id && event.revision !== operation.feedback.revision)
      operation.published = event.revision
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
    // A newer latest revision replaces the provisional view; its variants decide whether it carried the change.
    const operation = state.pendingOperation
    if (operation && revisionID !== operation.feedback.revision && revisionID === state.design?.revision) {
      state.pendingOperation = undefined
      state.operationCheck = {
        action: operation.feedback.action,
        revision: operation.feedback.revision,
        variants: operation.variants,
        working: !!operation.working,
        unchanged: false,
      }
    }
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
    // Restoring only means something for a revision that is no longer the latest one.
    element("restore").hidden = element("newer").hidden
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
      // A pick from the design that was on screen means nothing for the one replacing it.
      state.choice = ""
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
    showStudio(true)
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
      !state.choice &&
      onLatest &&
      current.revision !== state.revision &&
      !state.pending &&
      !document.hidden &&
      !root.querySelector("dialog[open]")
    if (current.revision && (initial || live) && state.failedPreview !== current.revision) {
      await chooseRevision(current.revision, live)
      if (live) status(copy.published, "published", "success")
    }
    // Rebuilding the options must not undo a pick that is still waiting for this refresh to finish.
    input("revisions").value = state.choice || state.failedPreview || state.revision
    element("newer").hidden = current.revision === state.revision
    element("restore").hidden = element("newer").hidden
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
  element("new").onclick = () =>
    void run(async () => {
      state.creating = true
      save()
      showStudio(false)
    }, element("new")).then(() => {
      // Controls stay disabled until the task settles, so focus moves into the brief afterwards.
      if (state.creating && !element("intake").hidden) input("name").focus()
      else more.focus()
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
  // Both pickers read their value when it changes: a queued task that read it later would see the
  // value a refresh in flight restored instead of the reader's choice.
  element("designs").onchange = () => {
    const id = input("designs").value as Design.ID
    void run(() => refresh(id))
  }
  element("revisions").onchange = () => {
    const id = input("revisions").value
    // run skips a task while another action is working; a pick it never loads must not stay pending.
    if (state.working) return
    state.choice = id
    void run(async () => {
      try {
        await chooseRevision(id)
      } finally {
        if (state.choice === id) state.choice = ""
      }
    })
  }
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
  const send = async (end: boolean) => {
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
      delivery: "steer",
      end,
    }
    save()
    drawNotes()
    controls()
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
  }
  click("send", () => send(false))
  click("send-end", () => send(true))
  const sendNow = () => {
    if (state.working) {
      status(copy.busy, "busy")
      return
    }
    void run(() => send(false), element("send"))
  }
  input("note").onkeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    sendNow()
  }
  input("card-text").oninput = () => {
    if (!state.card) return
    state.card.text = input("card-text").value
    save()
  }
  // Enter queues the note, Shift+Enter breaks the line, Ctrl/Cmd+Enter queues and sends it right
  // away; Escape closes an empty card and otherwise hands focus back to the page.
  input("card-text").onkeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === "Escape") {
      event.preventDefault()
      if (!input("card-text").value.trim()) closeCard()
      else focusToggle()
      return
    }
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    const queued = queueCard()
    if (!(event.ctrlKey || event.metaKey)) return
    // An empty card with notes already queued still sends them.
    if (!queued && !input("card-text").value.trim()) closeCard()
    sendNow()
  }
  element("card-close").onclick = closeCard
  element("card-add").onclick = () => void queueCard()
  // One click turns every ticked observation into a note; the observations stay listed as queued
  // until a newer revision either drops them (resolved) or still reports them (reopened).
  element("queue-fixes").onclick = () => {
    if (state.pending) return
    const items = state.inbox.filter((item) => item.status === "open" && state.picked.includes(item.id))
    if (!items.length) return
    const params = paramContext()
    // A reopened finding whose note is still queued is not queued twice.
    state.notes.push(
      ...items
        .filter((item) => !state.notes.some((note) => note.target === item.target && note.text === item.text))
        .map((item) => ({
          target: item.target,
          params,
          revision: state.revision,
          text: item.text,
          tag: item.tag,
          label: item.label,
        })),
    )
    for (const item of items) item.status = "queued"
    state.picked = []
    save()
    drawNotes()
    drawInbox()
  }
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
      delivery: "steer",
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

  // Variant operations: the agent carries each one out in a new revision; the page shows it at once.
  const operationBlocked = () =>
    state.working ||
    !state.revision ||
    !!state.failedPreview ||
    state.revision !== state.design?.revision ||
    !!state.design?.ended ||
    !!state.pendingOperation
  const provisional = (items: { id: string; name: string }[]) => {
    const action = state.pendingOperation?.feedback.action
    if (!action) return items
    const [id] = action.variants
    if (action.kind === "delete") return items.filter((item) => item.id !== id)
    if (action.kind === "rename") return items.map((item) => (item.id === id ? { ...item, name: action.name! } : item))
    if (action.kind === "reorder") {
      const ordered = (action.order ?? []).flatMap((id) => items.filter((item) => item.id === id))
      return [...ordered, ...items.filter((item) => !ordered.includes(item))]
    }
    return items
  }
  const showOperation = (frame: "preview" | "peer-preview") => {
    const action = state.pendingOperation?.feedback.action
    const target = element<HTMLIFrameElement>(frame).contentWindow
    if (!action || !target) return
    if (action.kind === "delete") target.postMessage({ type: "design:variant-hide", id: action.variants[0] }, "*")
    if (action.kind === "rename")
      target.postMessage({ type: "design:variant-label", id: action.variants[0], name: action.name }, "*")
    if (action.kind === "reorder") target.postMessage({ type: "design:variant-order", order: action.order }, "*")
  }
  /** Whether the variants on screen still look the way they did before the operation. */
  const unchanged = (
    check: { action: Design.VariantOperation; variants: { id: string; name: string }[] },
    after: { id: string; name: string }[],
  ) => {
    const { action, variants: before } = check
    const [id] = action.variants
    if (action.kind === "delete") return after.some((item) => item.id === id)
    if (action.kind === "rename")
      return after.find((item) => item.id === id)?.name === before.find((item) => item.id === id)?.name
    if (action.kind === "merge") return action.variants.every((id) => after.some((item) => item.id === id))
    if (action.kind === "split") return after.every((item) => before.some((old) => old.id === item.id))
    const ids = after.map((item) => item.id).filter((id) => before.some((item) => item.id === id))
    return ids.join("\n") === before.map((item) => item.id).join("\n")
  }
  const reloadFrames = () => {
    state.restoreScroll = true
    for (const id of ["preview", ...(state.comparing ? ["peer-preview"] : [])]) {
      const frame = element<HTMLIFrameElement>(id)
      frame.removeAttribute("srcdoc")
      frame.srcdoc = state.html
    }
  }
  /** Reverts a provisional change still on screen and reports why, keeping the request for a retry. */
  const failOperation = (message: string) => {
    const operation = state.pendingOperation
    const action = operation?.feedback.action ?? state.operationCheck?.action
    state.pendingOperation = undefined
    state.operationCheck = undefined
    if (action) state.operationDraft = action
    if (operation && operation.feedback.revision === state.revision) {
      state.variants = operation.variants
      if (operation.variants.some((item) => item.id === operation.variant)) state.variant = operation.variant
      reloadFrames()
    }
    const text = `${copy.operationFailed} ${message}`
    element("operation-error").textContent = text
    element("operation-state").hidden = false
    status(text, undefined, "error")
    save()
    drawVariants()
  }
  const startOperation = async (action: Design.VariantOperation) => {
    // Runs inside `run`, so the working flag is already set; every other block still applies.
    if (
      state.pendingOperation ||
      !state.design ||
      !state.revision ||
      state.failedPreview ||
      state.revision !== state.design.revision ||
      state.design.ended
    )
      return
    const feedback = {
      id: `msg_${crypto.randomUUID()}` as Design.Feedback["id"],
      revision: state.revision,
      text: "",
      items: [],
      assets: [],
      snapshot: "",
      delivery: "steer" as const,
      end: false,
      action,
      ...(state.variant ? { params: { values: {}, variant: state.variant } } : {}),
    }
    state.pendingOperation = {
      feedback,
      variants: state.variants.map((item) => ({ ...item })),
      variant: state.variant,
      phase: "sending",
      ...(state.agent === "working" ? { working: true } : {}),
    }
    state.operationDraft = action
    state.operationCheck = undefined
    if (action.kind === "merge") for (const id of action.variants.slice(1)) state.retarget[id] = action.variants[0]
    state.merging = false
    state.mergePick = []
    element("operation-state").hidden = true
    // Show the change before the request settles.
    showOperation("preview")
    if (state.comparing) showOperation("peer-preview")
    state.variants = provisional(state.variants)
    if (!state.variants.some((item) => item.id === state.variant)) state.variant = state.variants[0]?.id ?? ""
    save()
    drawVariants()
    try {
      await api(`/${state.design.id}/feedback`, "POST", feedback)
    } catch (error) {
      if (state.pendingOperation?.feedback.id === feedback.id)
        failOperation(error instanceof Error ? error.message : copy.failure)
      return
    }
    if (state.pendingOperation?.feedback.id === feedback.id) state.pendingOperation.phase = "applying"
    save()
    status(copy.operationRequested, "operationRequested", "success")
  }
  const variantLabels = (ids: readonly string[]) =>
    ids.map((id) => state.variants.find((item) => item.id === id)?.name.slice(0, 100) ?? id)
  const operationDialog = element<HTMLDialogElement>("operation-dialog")
  const openOperation = (kind: Design.VariantOperationKind, variants: string[]) => {
    if (operationBlocked() || !variants.length) return
    if (kind === "merge" && variants.length < 2) {
      status(copy.mergeNeedsTwo, "mergeNeedsTwo", "error")
      return
    }
    const draft =
      state.operationDraft?.kind === kind && state.operationDraft.variants.join("\n") === variants.join("\n")
        ? state.operationDraft
        : undefined
    state.composing = { kind, variants }
    const key = (suffix: "Heading" | "Action") => `${kind}${suffix}` as keyof ReviewCopy
    element("operation-heading").dataset.copy = key("Heading")
    element("operation-heading").textContent = copy[key("Heading")]
    element("confirm-operation").dataset.copy = key("Action")
    element("confirm-operation").textContent = copy[key("Action")]
    element("operation-subject").textContent = variantLabels(variants).join(kind === "merge" ? " + " : ", ")
    const hint = kind === "rename" ? undefined : (`${kind}Hint` as keyof ReviewCopy)
    element("operation-hint").hidden = !hint
    if (hint) {
      element("operation-hint").dataset.copy = hint
      element("operation-hint").textContent = copy[hint]
    }
    element("operation-name-field").hidden = kind !== "rename"
    input("operation-name").required = kind === "rename"
    input("operation-name").value = draft?.name ?? variantLabels(variants)[0]
    element("operation-text-field").hidden = kind !== "merge" && kind !== "split"
    input("operation-text").value = draft?.text ?? ""
    operationDialog.showModal()
    controls()
    if (kind === "rename") input("operation-name").select()
    else if (kind === "delete") element("cancel-operation").focus()
    else input("operation-text").focus()
  }
  const composed = (): Design.VariantOperation | undefined => {
    const current = state.composing
    if (!current) return undefined
    const text = input("operation-text").value.trim().slice(0, 2000)
    return {
      kind: current.kind,
      variants: current.variants,
      labels: variantLabels(current.variants),
      ...(current.kind === "rename" ? { name: input("operation-name").value.trim().slice(0, 100) } : {}),
      ...((current.kind === "merge" || current.kind === "split") && text ? { text } : {}),
    }
  }
  // Typed guidance and names stay with the request until it is sent, including across a reload.
  for (const id of ["operation-name", "operation-text"])
    input(id).addEventListener("input", () => {
      const action = composed()
      if (!action || (action.kind === "rename" && !action.name)) return
      state.operationDraft = action
      save()
    })
  element("operation-form").addEventListener("submit", (event) => {
    event.preventDefault()
    const action = composed()
    if (!action || (action.kind === "rename" && !action.name)) return
    if (state.working) {
      status(copy.busy, "busy")
      return
    }
    operationDialog.close()
    void run(() => startOperation(action), element("variant-actions"))
  })
  element("cancel-operation").addEventListener("click", () => operationDialog.close())
  operationDialog.addEventListener("close", () => {
    state.composing = undefined
    const trigger = element<HTMLButtonElement>("variant-actions")
    if (!trigger.hidden) trigger.focus()
  })
  const move = (step: -1 | 1) => {
    const index = state.variants.findIndex((item) => item.id === state.variant)
    const next = index + step
    if (operationBlocked() || index < 0 || next < 0 || next >= state.variants.length) return
    const ids = state.variants.map((item) => item.id)
    const order = [...ids]
    order.splice(index, 1)
    order.splice(next, 0, ids[index])
    void run(() => startOperation({ kind: "reorder", variants: ids, labels: variantLabels(ids), order }))
  }
  element("merge-variants").addEventListener("click", () => openOperation("merge", [...state.mergePick]))
  element("cancel-merge").addEventListener("click", () => {
    state.merging = false
    state.mergePick = []
    drawVariants()
    element<HTMLButtonElement>("variant-actions").focus()
  })
  element("retry-operation").addEventListener("click", () => {
    const draft = state.operationDraft
    if (!draft) return
    if (draft.kind === "reorder") void run(() => startOperation({ ...draft, labels: variantLabels(draft.variants) }))
    else openOperation(draft.kind, [...draft.variants])
  })
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
      { type: "design:annotate", enabled: annotating() },
      "*",
    )
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage({ type: "design:variant", id: state.variant }, "*")
  }
  // Annotation is the main review action, so its toggle lives in the toolbar and on the A key.
  function annotating() {
    return element("annotate").getAttribute("aria-pressed") === "true"
  }
  function setAnnotate(enabled: boolean) {
    if (annotating() === enabled) return
    element("annotate").setAttribute("aria-pressed", String(enabled))
    if (enabled) {
      input("param-select").checked = false
      element<HTMLIFrameElement>("preview").contentWindow?.postMessage(
        { type: "design:params-select", enabled: false },
        "*",
      )
    }
    for (const id of ["preview", "peer-preview"])
      element<HTMLIFrameElement>(id).contentWindow?.postMessage({ type: "design:annotate", enabled }, "*")
  }
  element("annotate").onclick = () => setAnnotate(!annotating())
  // A toggles and Escape ends annotation unless something else owns the key: a field being typed
  // in, an open dialog, menu or card.
  const annotationKey = (key: string) => {
    if (element("studio").hidden || element("review-tools").hidden) return false
    if (root.querySelector("dialog[open]") || !element("menu").hidden || state.card) return false
    if (key.toLowerCase() === "a") {
      setAnnotate(!annotating())
      return true
    }
    if (key !== "Escape" || !annotating()) return false
    setAnnotate(false)
    return true
  }
  // Scoped shortcuts only see keys pressed with focus inside the review, and they listen on the host so
  // they run before any listener the embedding page registered on the document. Global shortcuts also
  // take keys pressed with nothing focused.
  const scoped = options.shortcuts === "scoped"
  const keys: EventTarget = scoped ? host : document
  const shortcut = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return
    if (event.defaultPrevented || event.isComposing || event.repeat) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key.toLowerCase() !== "a" && event.key !== "Escape") return
    const path = event.composedPath()
    const target = path[0]
    const idle = target === document.body || target === document.documentElement
    if (!path.includes(host) && (scoped || !idle)) return
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return
    if (annotationKey(event.key) && event.key !== "Escape") event.preventDefault()
  }
  keys.addEventListener("keydown", shortcut)
  // Clicking the review's plain surfaces (panel or stage background) puts focus on the host, so the next
  // key reaches the review instead of whatever the page does with keys pressed on its body.
  const hostTabIndex = host.getAttribute("tabindex")
  if (hostTabIndex === null) host.tabIndex = -1
  const focusable =
    "input, textarea, select, button, a[href], summary, label, iframe, [tabindex], [contenteditable]:not([contenteditable=false])"
  const surface = (event: Event) => {
    for (const item of event.composedPath()) {
      if (item === host) break
      if (item instanceof Element && item.matches(focusable)) return
    }
    host.focus({ preventScroll: true })
  }
  root.addEventListener("pointerdown", surface)
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
        if (state.pendingOperation?.feedback.revision === state.revision) showOperation("peer-preview")
        element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
          { type: "design:variant", id: state.peer },
          "*",
        )
        element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
          { type: "design:annotate", enabled: annotating() },
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
      const announced: { id: string; name: string }[] = event.data.variants
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
      const operation = state.pendingOperation
      // A freshly loaded frame still shows the original variants: repeat the provisional change.
      if (operation?.feedback.revision === state.revision) showOperation("preview")
      state.variants = operation?.feedback.revision === state.revision ? provisional(announced) : announced
      if (!state.variants.some((item) => item.id === state.variant)) state.variant = state.variants[0]?.id ?? ""
      const check = state.operationCheck
      if (check && state.revision !== check.revision && state.revision === state.design?.revision) {
        check.unchanged = unchanged(check, state.variants)
        if (!check.unchanged) {
          state.operationCheck = undefined
          state.operationDraft = undefined
          element("operation-state").hidden = true
          save()
        } else if (check.working && state.agent === "idle") failOperation(copy.operationUnchanged)
      }
      drawVariants()
      drawParams()
      // A restored card re-anchors to its element once the frame has rendered it.
      if (state.card?.frame === "preview") reveal(state.card.target, false)
      return
    }
    if (event.data?.type === "design:scroll" && typeof event.data.x === "number" && typeof event.data.y === "number") {
      if (event.source === element<HTMLIFrameElement>("preview").contentWindow)
        state.scroll = { x: event.data.x, y: event.data.y }
      if (event.source === element<HTMLIFrameElement>("peer-preview").contentWindow)
        state.peerScroll = { x: event.data.x, y: event.data.y }
      // The frame reports where the card's element went so the card follows it.
      const rect = box(event.data.rect)
      if (state.card && rect && event.source === element<HTMLIFrameElement>(state.card.frame).contentWindow) {
        state.card.rect = rect
        placeCard()
      }
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
      const field = (item: Record<string, unknown>, name: string, limit: number) =>
        typeof item[name] === "string" ? String(item[name]).slice(0, limit) : ""
      mergeFindings(
        event.data.findings
          .slice(0, 30)
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              !!item &&
              typeof item === "object" &&
              "text" in item &&
              typeof item.text === "string" &&
              "target" in item &&
              typeof item.target === "string",
          )
          .map((item: Record<string, unknown>) => ({
            target: field(item, "target", 1000),
            tag: field(item, "tag", 64),
            label: field(item, "label", 120) || field(item, "tag", 64) || field(item, "target", 120),
            severity: item.severity === "info" ? ("info" as const) : ("warn" as const),
            text: field(item, "text", 500),
          })),
      )
      return
    }
    const frame =
      event.source === element<HTMLIFrameElement>("preview").contentWindow
        ? "preview"
        : state.comparing && event.source === element<HTMLIFrameElement>("peer-preview").contentWindow
          ? "peer-preview"
          : undefined
    if (!frame) return
    if (event.data?.type === "design:key" && event.data.key === "Escape" && state.card) {
      if (!state.card.text.trim()) closeCard()
      else input("card-text").blur()
      return
    }
    if (event.data?.type === "design:key" && typeof event.data.key === "string") {
      annotationKey(event.data.key)
      return
    }
    if (event.data?.type === "design:rect") {
      if (!state.card || state.card.frame !== frame || state.card.target !== event.data.target) return
      const rect = box(event.data.rect)
      // The element is gone from this revision: the card has nothing to sit on.
      if (event.data.rect === null) closeCard()
      if (!rect) return
      state.card.rect = rect
      placeCard()
      return
    }
    if (event.data?.type !== "design:selection") return
    if (typeof event.data.target !== "string" || typeof event.data.text !== "string") return
    element("target").textContent = event.data.target.slice(0, 1000)
    input("selection").value = event.data.text.slice(0, 12000)
    state.snapshot = typeof event.data.snapshot === "string" ? event.data.snapshot.slice(0, 30000) : ""
    const field = (name: string, limit: number) =>
      typeof event.data[name] === "string" ? String(event.data[name]).slice(0, limit) : ""
    // Picking another element moves the card and keeps whatever was typed; nothing is lost by a
    // stray click and the header shows the new target.
    const moved = !!state.card?.text.trim() && state.card.target !== event.data.target
    state.card = {
      frame,
      target: event.data.target.slice(0, 1000),
      tag: field("tag", 64),
      elementText: field("elementText", 240),
      selectedText: field("selectedText", 12000),
      label: field("label", 120) || field("tag", 64) || "page",
      rect: box(event.data.rect) ?? { x: 0, y: 0, width: 0, height: 0 },
      text: state.card?.text ?? "",
    }
    save()
    drawCard()
    if (moved) {
      status(`${copy.cardMoved} ${state.card.label}`)
      element("card").classList.remove("moved")
      void element("card").offsetWidth
      element("card").classList.add("moved")
    }
    input("card-text").focus()
  }
  // A menu opens from its trigger, moves with the arrow keys, and closes on Escape, on an outside
  // pointer, or once an entry has been chosen. The header overflow and the variant actions share it.
  const dropdown = (hostID: string, triggerID: string, menuID: string, choose: (item: HTMLButtonElement) => void) => {
    const menu = element(menuID)
    const trigger = element<HTMLButtonElement>(triggerID)
    const items = () =>
      [...menu.querySelectorAll<HTMLButtonElement>("button")].filter((item) => !item.hidden && !item.disabled)
    const close = (refocus = false) => {
      if (menu.hidden) return
      menu.hidden = true
      trigger.setAttribute("aria-expanded", "false")
      if (refocus) trigger.focus()
    }
    const open = (last = false) => {
      syncMenu()
      menu.hidden = false
      trigger.setAttribute("aria-expanded", "true")
      const list = items()
      ;(last ? list.at(-1) : list[0])?.focus()
    }
    trigger.addEventListener("click", () => (menu.hidden ? open() : close(true)))
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      event.preventDefault()
      // The menu host would otherwise treat the same key as a move within the menu it just opened.
      event.stopPropagation()
      open(event.key === "ArrowUp")
    })
    element(hostID).addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close(true)
        return
      }
      if (menu.hidden || !["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return
      if (event.key === "Tab") {
        close()
        return
      }
      event.preventDefault()
      const list = items()
      const index = list.indexOf(root.activeElement as HTMLButtonElement)
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? list.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length
      list[next]?.focus()
    })
    menu.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement).closest("button")
      if (!item || item.disabled) return
      choose(item)
    })
    return { close, host: element(hostID) }
  }
  const more = element<HTMLButtonElement>("more")
  const overflow = dropdown("menu-host", "more", "menu", (item) => {
    // Create design opens the brief and takes focus there; the other entries hand it back.
    overflow.close(item.id !== "new")
    if (item.dataset.for) element(item.dataset.for).click()
  })
  const variantMenu = dropdown("variant-menu-host", "variant-actions", "variant-menu", (item) => {
    const opensDialog = ["rename-variant", "split-variant", "delete-variant", "select-merge"].includes(item.id)
    variantMenu.close(!opensDialog)
    if (item.dataset.for) return element(item.dataset.for).click()
    if (item.id === "move-left" || item.id === "move-right") return move(item.id === "move-left" ? -1 : 1)
    if (item.id === "select-merge") {
      state.merging = true
      state.mergePick = state.variant ? [state.variant] : []
      drawVariants()
      input(`merge-${state.variants.find((variant) => variant.id !== state.variant)?.id ?? state.variant}`)?.focus()
      return
    }
    openOperation(item.id === "rename-variant" ? "rename" : item.id === "split-variant" ? "split" : "delete", [
      state.variant,
    ])
  })
  const closeMenus = () => {
    overflow.close()
    variantMenu.close()
  }
  const outside = (event: Event) => {
    if (!event.composedPath().includes(overflow.host)) overflow.close()
    if (!event.composedPath().includes(variantMenu.host)) variantMenu.close()
  }
  document.addEventListener("pointerdown", outside)
  // A pointer landing in the preview frame never reaches this document, but it does take the
  // window's focus away.
  const blurred = () => closeMenus()
  window.addEventListener("blur", blurred)
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
    document.removeEventListener("pointerdown", outside)
    keys.removeEventListener("keydown", shortcut)
    root.removeEventListener("pointerdown", surface)
    if (hostTabIndex === null) host.removeAttribute("tabindex")
    window.removeEventListener("blur", blurred)
    window.removeEventListener("message", message)
    root.replaceChildren()
  }
  return Object.assign(dispose, {
    updateCopy(next: ReviewCopy) {
      if (state.stopped) return
      Object.assign(copy, next)
      platformize()
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

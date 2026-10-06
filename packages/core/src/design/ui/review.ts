import type { Design } from "@opencode/schema/design"
import type { SessionTodo } from "@opencode/schema/session-todo"
import type { ReviewCopy } from "./copy.js"
import type { viewports } from "./viewports.js"
import type { device } from "./devices.js"
import type { stage } from "./stage.js"
import type { deck } from "./slides.js"
import type { LoadingEvent, LoadingState, previewLoading } from "./loading.js"

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
  /**
   * The shared viewport definition from ./viewports, passed in because this function is serialized
   * on its own. With it the width picker offers the open design's target viewports; without it, the
   * default web breakpoints.
   */
  viewports?: typeof viewports
  /** The configured web breakpoints (`design.breakpoints`), which `viewports` offers for a web design. */
  breakpoints?: readonly number[]
  /**
   * The phone frames from ./devices, passed in like `viewports`. With it an app design is previewed
   * inside the frame of its platform, with an iOS/Android switch; without it, at the phone's width.
   */
  device?: typeof device
  /** Preview frame geometry from ./stage: scale-to-fit and where a scaled frame's rects land in its pane. */
  stage: typeof stage
  /** Deck logic from ./slides; with it the arrow keys, Space, Page Up/Down, Home and End move between a presentation's slides. */
  deck?: typeof deck
  /** The preview area's loading, zero and error states from ./loading. */
  loading: typeof previewLoading
  /** Follows the server's conversation feed; absent when the host renders the conversation itself. */
  feed?: (
    url: string,
    request: (url: string, init?: RequestInit) => Promise<Response>,
    signal: AbortSignal,
    onEvent: (event: Design.FeedEvent) => void,
    onUnavailable: () => void,
    onStatus: (status: "live" | "offline") => void,
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
    transport(url, {
      cache: "no-store",
      ...init,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    })
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
    mode: "",
    design: undefined as Design.Info | undefined,
    revision: "",
    /** Following latest survives a refresh deferred while the reader is interacting. */
    followLatest: true,
    /** A revision the reader picked whose load is still queued behind another task, such as a poll. */
    choice: "",
    failedPreview: "",
    revisionInfo: undefined as Design.Revision | undefined,
    revisions: [] as Design.Revision[],
    audits: [] as Design.Job[],
    /** The design's jobs from the last poll: verify jobs tell how far a round got, running ones keep the agent busy. */
    jobs: [] as Design.Job[],
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
          xpath: string
          context: string
          parent: string
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
    feedbackError: "",
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
    /** Screens the preview frame announced, each in its variant ("" outside variants). */
    screens: [] as { id: string; name: string; variant: string }[],
    /** The screen each variant shows in the preview frame. */
    screenCurrent: {} as Record<string, string>,
    /** Screens to reopen once a live-reloaded frame announces its own. */
    restoreScreens: undefined as Record<string, string> | undefined,
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
          /** A turn took its message up: the feed echoed it delivered, not merely admitted. */
          consumed?: boolean
          /** The agent was working after taking it up. */
          working?: boolean
          /** The agent went idle again after that. */
          idle?: boolean
          published?: string
        }
      | undefined,
    /** An operation whose newer revision arrived; it fails if that revision left it undone once the agent is idle. */
    operationCheck: undefined as
      | {
          action: Design.VariantOperation
          feedback: string
          revision: string
          variants: { id: string; name: string }[]
          consumed: boolean
          working: boolean
          idle: boolean
          unchanged: boolean
        }
      | undefined,
    /** The operation last reported as failed; a later revision that carries it out settles it after all. */
    lastFailure: undefined as
      | { action: Design.VariantOperation; revision: string; variants: { id: string; name: string }[] }
      | undefined,
    /** Pending check that an idle agent stayed idle; a following turn reports working first. */
    idleCheck: undefined as ReturnType<typeof setTimeout> | undefined,
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
    captureFailed: false,
    /** Why the last approval capture failed, shown beside the notice so a failure can be diagnosed. */
    captureReason: "",
    approvalScreenshot: undefined as { revision: string; variant: string; asset: string } | undefined,
    feed: [] as Design.FeedEvent[],
    scroll: { x: 0, y: 0 },
    peerScroll: { x: 0, y: 0 },
    restoreScroll: false,
    /**
     * The phone frame the reviewer peeks at: a preview-only choice that never changes the design's platform;
     * unset, the design's own platform (iPhone without one) is shown.
     */
    device: undefined as "ios" | "android" | undefined,
    /** The revision and slides the thumbnail strip was built for; unchanged, its frames are kept. */
    strip: "",
  }
  /**
   * What the page knows about how current it is, apart from the capped feed rows. Every connect replays the
   * conversation with sequence 0 and the times its messages were written, so only live events (sequence above 0),
   * timed by their arrival, say anything about now.
   */
  const liveness = {
    feed: (options.feed ? "connecting" : "none") as "none" | "connecting" | "live" | "offline" | "unavailable",
    /** The last poll could not reach the server at all. */
    unreachable: false,
    /** The feed delivered conversation history, so `published` holds every revision the agent published. */
    replayed: false,
    /** When the last live event arrived. */
    last: 0,
    /** When the agent last went idle, and whether a live event said so (a connect only reports the state). */
    idleSince: 0,
    idleLive: false,
    /** The tool a live event reported running. */
    tool: undefined as { id: string; name: string; summary: string; since: number } | undefined,
    /** Revisions the agent published or restored, as the feed reported them. */
    published: new Set<string>(),
    /** Messages to the agent still waiting in its inbox. */
    inbox: new Set<string>(),
    /** A live publish of this design that the design list does not show yet. */
    announced: "",
    /** The latest revision whose live reload failed, and why; the last good frame stays on screen. */
    failed: "",
    failure: "",
    /** The revision being loaded. */
    loading: "",
    /** A newer revision replaced the one on screen after waiting; the line says when it was published. */
    switched: undefined as { revision: string; created: number } | undefined,
    switchedTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  }
  const geometry = options.stage()
  const loader = options.loading()
  const loading = {
    view: loader.initial(Date.now()),
    /** Shows a frame whose runtime never reports ready (a page without the design runtime) after a while. */
    reveal: undefined as ReturnType<typeof setTimeout> | undefined,
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
      throw Object.assign(
        new Error(`HTTP ${response.status}: ${typeof body?.message === "string" ? body.message : copy.failure}`),
        { status: response.status },
      )
    }
    return response.json()
  }
  /** Notes of every round still awaiting an outcome; the same rule as DesignRounds.open on the server. */
  const openNotes = () => (state.design?.notes ?? []).filter((note) => note.status === "open")
  const element = <T extends HTMLElement>(id: string) => root.getElementById(id) as T
  const input = (id: string) => element<HTMLInputElement>(id)
  const key = () => `redcode:design:${endpoint}:${state.design?.id}:${state.revision}`
  const dismissedKey = () => `redcode:design:${endpoint}:${state.design?.id}:dismissed`
  /** Cuts by code point like the frame does, so a surrogate pair is never split. */
  const cut = (value: string, limit: number) => {
    const chars = [...value]
    return chars.length > limit ? chars.slice(0, limit).join("") : value
  }
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
        if (!state.stopped && !quiet && element("status").dataset.copy === "busy") status(copy.done, "done", "success")
      } catch (error) {
        if (!state.stopped) status(error instanceof Error ? error.message : copy.failure, undefined, "error")
      } finally {
        state.loading = false
        if (polling.requested) queueMicrotask(poll)
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
    single: icon('<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.5"/>'),
    compare: icon(
      '<rect x="1.7" y="3.2" width="5.4" height="9.6" rx="1.3"/><rect x="8.9" y="3.2" width="5.4" height="9.6" rx="1.3"/>',
    ),
    attach: icon(
      '<path d="M12.6 7.3 8 11.9a2.6 2.6 0 0 1-3.7-3.7l5-5a1.7 1.7 0 0 1 2.4 2.4L6.9 10.4a.8.8 0 0 1-1.1-1.1L10 5.1"/>',
    ),
  }
  root.innerHTML = `<style>${options.appearance?.css ?? ""}</style><style>
:host(:focus){outline:none}:host{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color-scheme:light dark;--surface:var(--reddb-color-background);--panel:var(--reddb-color-elevation-raised-surface);--canvas:var(--reddb-color-elevation-sunken-surface);--ink:var(--reddb-color-foreground);--muted:var(--reddb-color-ink-muted);--edge:var(--reddb-color-elevation-base-border);--accent:var(--reddb-color-primary);--accent-ink:var(--reddb-color-on-primary);background:var(--surface);color:var(--ink);font:13px/1.5 var(--reddb-font-family-sans,system-ui)}
*{box-sizing:border-box}[hidden]{display:none!important}button,input,select,textarea{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);padding:var(--reddb-spatial-gap-md) var(--reddb-spatial-inset-sm);min-height:var(--reddb-spatial-control-height-md);min-width:0}button{cursor:pointer;line-height:18px;transition:background-color var(--reddb-duration-fast) ease,border-color var(--reddb-duration-fast) ease}button:hover{background:var(--panel);border-color:var(--muted)}button:active{background:var(--canvas)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled{opacity:.45;cursor:default}.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}.primary:hover{background:color-mix(in oklch,var(--accent) 88%,var(--ink));border-color:var(--accent)}
header{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--edge);flex:none;min-width:0}#toolbar{flex-wrap:wrap;gap:6px;padding:5px 12px;background:var(--panel)}#toolbar :is(button,select):not(.icon){padding-top:3px;padding-bottom:3px;min-height:28px}h1{font-size:13px;letter-spacing:-.02em;margin:0 6px 0 0;display:flex;align-items:center;gap:6px;white-space:nowrap}h1 img{width:18px;height:18px;display:block}h2{font-size:15px;letter-spacing:-.015em;margin:0 0 12px}#toolbar select{width:auto;max-width:220px;flex:0 1 200px;min-width:0}.tools{display:contents}.actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;flex:0 1 auto;min-width:0;margin-left:auto}.spacer{flex:1 1 0;min-width:8px}#toolbar #width{flex:0 0 auto;width:auto;max-width:130px}#restore{border-color:transparent;background:transparent;color:var(--muted)}#approve,#reopen,#newer,#restore{white-space:nowrap}#toolbar #annotate{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap;padding-inline:8px 10px;color:var(--muted)}#annotate svg{display:block;flex:none}#annotate:hover{color:var(--ink)}#annotate[aria-pressed=true]{background:color-mix(in oklch,var(--accent) 16%,var(--surface));border-color:var(--accent);color:var(--ink);font-weight:600}.icon{width:28px;height:28px;min-height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:none;background:transparent;color:var(--muted)}.icon:hover{color:var(--ink)}.icon svg{display:block}.menu-host{position:relative;flex:none;display:flex}#menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:200px;padding:4px;display:grid;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);box-shadow:0 8px 28px color-mix(in oklch,var(--ink) 18%,transparent)}#toolbar #menu button{border:0;background:transparent;text-align:left;border-radius:4px;padding:6px 10px;min-height:0;white-space:nowrap}#toolbar #menu button:hover,#toolbar #menu button:focus-visible{background:var(--panel);outline-offset:-2px}
#studio{flex:1;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr)}main{min-height:0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 336px;overflow:hidden}.canvas{background:var(--canvas);overflow:auto;min-height:0;min-width:0;padding:24px}iframe{display:block;background:oklch(99% .002 220);border:0;height:100%;min-height:0;width:100%;margin:0 auto;box-shadow:0 0 0 1px var(--edge),0 6px 24px color-mix(in oklch,var(--ink) 7%,transparent)}aside{min-height:0;min-width:0;border-left:1px solid var(--edge);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}.tabs{display:flex;padding:0 16px;border-bottom:1px solid var(--edge);gap:18px}.tabs button{border:0;border-radius:0;background:none;padding:13px 0;color:var(--muted);position:relative}.tabs button[aria-selected=true]{color:var(--ink);font-weight:600}.tabs button[aria-selected=true]::after{content:"";position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--accent)}.panel{overflow:auto;min-height:0;padding:20px}.panel>p{margin:0 0 16px}.section{margin-top:24px;padding-top:18px;border-top:1px solid var(--edge)}label{display:grid;gap:6px;margin-bottom:14px;font-size:12px;font-weight:500}label input,label select,label textarea{font-size:13px;font-weight:400}textarea{min-height:96px;resize:vertical;width:100%;line-height:1.55}input:not([type=checkbox]),select{max-width:100%;width:100%}input[type=checkbox]{accent-color:var(--accent);margin:0}label.check{display:flex;align-items:center;gap:8px;font-weight:400}.row{display:flex;gap:8px;align-items:center}.row>*{flex:1;min-width:0}#add{margin-bottom:14px}#attachment{font-size:11px;padding:6px;width:100%}#attachment::file-selector-button{font:inherit;border:0;border-radius:3px;padding:4px 7px;margin-right:8px;background:var(--panel);color:var(--ink);cursor:pointer}
details{border-top:1px solid var(--edge);padding:14px 0}summary{cursor:pointer;font-weight:600;list-style-position:inside;color:var(--ink);margin-bottom:0}details[open]>summary{margin-bottom:14px}details:last-child{padding-bottom:0}.note{padding:10px 0;border-bottom:1px solid var(--edge);overflow-wrap:anywhere}.note button{float:right;padding:2px 7px;font-size:11px}.muted,small{font-size:12px;color:var(--muted);font-weight:400}small{display:block}#target{overflow-wrap:anywhere;background:var(--panel);font:11px/1.5 ui-monospace,monospace;padding:7px 9px;border-radius:4px;margin:12px 0}#target:empty{display:none}#status{flex:none;min-height:28px;padding:5px 16px;border-top:1px solid var(--edge);font-size:11px;color:var(--muted)}#status:empty{display:none}.asset{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--edge)}.asset img{width:48px;height:48px;object-fit:contain;background:var(--panel);border-radius:4px}#jobs .note{display:grid;gap:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#source-files{font-size:12px;overflow-wrap:anywhere}#html,#audit,#compare,#gif{margin-bottom:12px}#intake{flex:1;overflow:auto}form.intake{max-width:600px;margin:32px auto;padding:24px}form.intake h2{font-size:24px;margin-bottom:24px}#board-dialog{padding:12px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}#board-dialog::backdrop{background:color-mix(in oklch,var(--canvas) 70%,transparent)}#board-close{margin-bottom:12px}#board-frame{box-shadow:none}.canvas:has(iframe[src="about:blank"])::before{content:attr(data-empty);display:block;color:var(--muted);text-align:center;padding:24px}
@container(max-width:860px){#toolbar{padding:4px 10px}#toolbar #annotate{width:28px;padding:0;justify-content:center}#annotate .label{display:none}h1{margin-right:2px}#toolbar select{flex:1 1 140px;max-width:200px}#restore{font-size:0;width:28px;height:28px;flex:none;padding:0}#restore::before{content:"↶";font-size:18px}main{grid-template-columns:minmax(0,1fr) 300px}.canvas{padding:16px}.panel{padding:16px}}
@container(max-width:640px){:host{min-height:0}#toolbar select{flex:1 1 120px;max-width:none}#toolbar #width{flex:0 1 84px;max-width:84px}#approve,#reopen{font-size:12px;padding-left:8px;padding-right:8px}main{display:grid;grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(220px,.85fr)}.canvas{padding:12px}aside{border-left:0;border-top:1px solid var(--edge)}.tabs{gap:24px}.tabs button{padding:10px 0}.panel{padding:16px}form.intake{margin:0;padding:20px}}
.variant-bar{display:flex;align-items:center;gap:6px;padding:0 12px;border-bottom:1px solid var(--edge);min-width:0;min-height:31px}.variant-bar .tabs{border:0;padding:0;flex:0 1 auto;min-width:0;overflow:auto;gap:14px}.variant-bar .tabs button{white-space:nowrap;padding:6px 0;font-size:12px}.variant-tab{display:inline-flex;align-items:center;gap:2px}.variant-bar .tabs .variant-close{white-space:nowrap;width:16px;height:16px;min-height:16px;padding:0;border:0;background:transparent;color:var(--muted);font-size:13px;line-height:1;flex:none;display:inline-flex;align-items:center;justify-content:center;opacity:0}.variant-tab:hover .variant-close,.variant-tab:focus-within .variant-close{opacity:1}.variant-bar .tabs .variant-close:hover{color:var(--ink);background:var(--panel)}@media(pointer:coarse){.variant-bar .tabs .variant-close{opacity:1}}#no-variants{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.variant-bar .icon{width:24px;height:24px;min-height:24px}.variant-bar .icon[aria-pressed=true]{background:var(--panel);border-color:var(--accent);color:var(--accent)}#variant-actions{display:inline-flex;align-items:center;gap:6px;width:auto;height:auto;min-height:24px;padding:2px 8px;flex:none;background:transparent;color:var(--muted)}#variant-actions:hover{color:var(--ink)}#variant-actions svg{display:block;flex:none}.screen-bar{display:flex;align-items:center;gap:10px;min-width:0;flex:none;font-size:12px;padding:0 0 6px}.screen-bar[hidden]{display:none}.screen-bar .tabs{border:0;padding:0;gap:12px;min-width:0;overflow:auto}.screen-bar .tabs button{white-space:nowrap;padding:4px 0;font-size:12px}.segment{display:inline-flex;gap:2px;flex:none}.canvas{display:flex;gap:20px;padding:16px}.preview-pane{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%}.viewport{flex:1;min-height:0;overflow:auto;padding:1px}.viewport iframe{height:100%;min-height:150px}.pane-label{height:38px;flex:none;font-size:12px;display:flex;align-items:center;gap:8px;margin:0;padding-bottom:6px}.pane-label select{width:auto;flex:1;padding:4px 8px}.canvas[data-comparing=true] .preview-pane{min-width:280px}.action-dialog{width:min(520px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:24px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:10px}.action-dialog::backdrop{background:#0008}.action-dialog p{overflow-wrap:anywhere}.action-dialog .row{justify-content:flex-end}.action-dialog .row>*{flex:0 1 auto}#status{font-size:13px;min-height:38px;padding:9px 16px;background:var(--panel);border-bottom:1px solid var(--edge);border-top:0;color:var(--ink)}#status[data-tone=error]{color:var(--reddb-color-feedback-danger-foreground)}#status[data-tone=success]{color:var(--reddb-color-feedback-success-foreground)}button[aria-busy=true]{opacity:1;cursor:progress}button[aria-busy=true]::before{content:"";display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.preview-pane[aria-busy=true] .viewport{opacity:.5}@container(max-width:640px){.variant-bar{padding:0 10px}.canvas{padding:12px;gap:12px}.variant-bar .tabs .variant-close{opacity:1}#variant-actions{padding:0;width:28px;justify-content:center}#variant-actions .label{display:none}}
@media(prefers-reduced-motion:reduce){button{transition:none}button[aria-busy=true]::before{animation:none}}
#feed-empty{margin:0}.entry{padding:8px 10px;border-radius:var(--reddb-radius-md);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5}.entry[data-kind=user]{background:color-mix(in oklch,var(--accent) 10%,var(--panel))}.entry[data-kind=tool]{font:11px/1.5 ui-monospace,monospace;color:var(--muted);padding:4px 10px;background:transparent}.entry[data-kind=published]{color:var(--reddb-color-feedback-success-foreground);font-weight:600}.entry[data-kind=verified]{display:grid;gap:4px}.entry[data-kind=verified] strong{display:block}.verdict{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 8px}.verdict .glyph{font-weight:700}.verdict[data-verdict=pass] .glyph{color:var(--reddb-color-feedback-success-foreground)}.verdict[data-verdict=warn] .glyph{color:var(--accent)}.verdict[data-verdict=fail] .glyph{color:var(--reddb-color-feedback-danger-foreground)}.verdict small{display:inline}.entry a{color:var(--accent)}
#approval-review-list,#approval-open-list{margin:0 0 12px;padding-left:18px;font-size:12px;overflow-wrap:anywhere}
.viewport{position:relative}.device{display:contents}.device-chrome{display:none}.viewport[data-device]{overflow:hidden}.viewport[data-device] .device{display:block;position:absolute;left:0;top:0;transform-origin:0 0}.viewport[data-device] .device-chrome{display:block}.viewport[data-device] .device iframe{position:absolute;z-index:1;left:var(--device-bezel);top:var(--device-bezel);width:var(--device-width);height:var(--device-height);min-height:0;border-radius:var(--device-radius);box-shadow:none}#device-switch button{min-height:0;padding:3px 10px;font-size:12px}.viewport[data-device=slide] .device iframe{box-shadow:0 0 0 1px var(--edge)}.screen-bar[data-slides=true] .tabs{gap:8px;padding:2px}.thumb{position:relative;flex:none;width:160px;height:90px;overflow:hidden;border-radius:4px;background:var(--panel)}.thumb iframe{position:absolute;left:0;top:0;width:1920px;height:1080px;min-height:0;margin:0;border:0;transform:scale(.0833333);transform-origin:0 0;pointer-events:none;box-shadow:none}.screen-bar .tabs .thumb button{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:flex-start;padding:4px;border:0;border-radius:4px;background:transparent;box-shadow:inset 0 0 0 1px var(--edge);min-height:0;font-size:10px}.thumb button span{padding:0 5px;border-radius:3px;background:var(--surface);color:var(--ink);font-weight:600}.screen-bar .tabs .thumb button[aria-selected=true]{box-shadow:inset 0 0 0 2px var(--accent)}#slide-count{font-variant-numeric:tabular-nums;white-space:nowrap}#device-switch button[aria-pressed=true]{background:var(--panel);border-color:var(--accent);color:var(--accent)}#card{position:absolute;z-index:2;width:min(320px,100%);padding:10px 12px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);box-shadow:0 8px 28px color-mix(in oklch,var(--ink) 18%,transparent);display:grid;gap:8px}#card header{padding:0;border:0;gap:8px;font-size:12px;font-weight:600;overflow-wrap:anywhere}#card header span{flex:1;min-width:0}#card-close{flex:none;padding:0 6px;min-height:24px;font-size:14px;line-height:1}#card-text{min-height:64px;width:100%;resize:vertical}#card .row{justify-content:flex-end}#card .row>*{flex:0 1 auto}#card small{font-size:11px}#card.moved header{animation:card-moved .6s ease-out 2}@keyframes card-moved{50%{color:var(--accent)}}
.note{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}.note .note-label{font-weight:600;font-size:12px}.note .note-text{flex:1 1 100%;white-space:pre-wrap}.note button{float:none;margin-left:auto;padding:2px 7px;font-size:11px}.note button+button{margin-left:0}.note:hover{background:color-mix(in oklch,var(--panel) 60%,transparent)}

#inbox-count{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--panel);border:1px solid var(--edge);color:var(--muted)}#inbox-count[data-open="true"]{color:var(--accent-ink);background:var(--accent);border-color:var(--accent)}.finding{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px;padding:8px 0;border-bottom:1px solid var(--edge);font-size:12px;overflow-wrap:anywhere}.finding input{margin-top:3px}.finding .finding-tag{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;border:1px solid var(--edge);color:var(--muted);align-self:start;margin-top:2px}.finding[data-severity=warn] .finding-tag{color:var(--reddb-color-feedback-danger-foreground);border-color:currentColor}.finding[data-status=resolved]{color:var(--muted)}.finding .finding-body{display:grid;gap:2px}.finding .finding-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}.finding .finding-actions button{padding:2px 7px;font-size:11px}.finding .finding-status{font-size:11px;color:var(--muted)}#queue-fixes{margin-top:10px}#inbox-empty{margin:6px 0 0}
#variant-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:200px;padding:4px;display:grid;background:var(--surface);color:var(--ink);border:1px solid var(--edge);border-radius:var(--reddb-radius-md);box-shadow:0 8px 28px color-mix(in oklch,var(--ink) 18%,transparent)}#variant-menu button{border:0;background:transparent;text-align:left;border-radius:4px;padding:6px 10px;min-height:0;white-space:nowrap;font-size:12px}#variant-menu button:hover,#variant-menu button:focus-visible{background:var(--panel);outline-offset:-2px}.op-badge{margin-left:6px;font-size:10px;font-weight:600;line-height:16px;padding:0 6px;border-radius:999px;border:1px solid currentColor;color:var(--accent);white-space:nowrap}.variant-bar .tabs button[data-operation]{color:var(--accent)}#merge-bar{display:flex;align-items:center;gap:10px;min-width:0;overflow:auto;font-size:12px}#merge-options{display:flex;gap:10px}#merge-bar label{margin:0;display:flex;gap:6px;align-items:center;font-weight:400;white-space:nowrap}#merge-bar button{min-height:24px;padding:1px 8px;font-size:12px;white-space:nowrap}#operation-state{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;margin:0 0 12px;border-radius:var(--reddb-radius-md);background:var(--panel);color:var(--reddb-color-feedback-danger-foreground);overflow-wrap:anywhere}#feedback-status[data-tone=error]{color:var(--reddb-color-feedback-danger-foreground)}#feedback-status[data-tone=success]{color:var(--reddb-color-feedback-success-foreground)}#operation-state button{padding:2px 8px;font-size:12px;color:var(--ink)}.note .note-orphaned{font-size:10px;font-weight:600;padding:0 6px;border-radius:4px;border:1px solid currentColor;color:var(--reddb-color-feedback-danger-foreground)}#approval-reselect{color:var(--reddb-color-feedback-danger-foreground)}
.canvas{position:relative}.preview-state{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;background:var(--canvas);pointer-events:none;overflow:hidden}.preview-state button{pointer-events:auto}.canvas[data-phase=ready] .preview-state{display:none}.canvas:not([data-phase=ready]) .preview-pane{opacity:0}.canvas[data-phase=ready] .preview-pane{opacity:1;transition:opacity .24s ease-out}.skeleton{display:flex;flex-direction:column;align-items:center;gap:10px;width:min(100%,760px)}.sk-strip{display:none;gap:8px;align-self:stretch;overflow:hidden}.sk-strip i{flex:none;width:80px;aspect-ratio:16/9;border-radius:4px}.sk-frame{width:min(100%,calc(50vh * 4 / 3));aspect-ratio:4/3;border-radius:var(--reddb-radius-md);background:var(--surface);box-shadow:0 0 0 1px var(--edge);display:flex;flex-direction:column;gap:12px;padding:6%}.sk-frame i{display:block;height:10px;border-radius:4px}.sk-frame i:first-child{height:18px;width:45%}.sk-frame i:nth-child(2){width:80%}.sk-frame i:nth-child(3){width:62%}.sk-strip i,.sk-frame i{background:linear-gradient(90deg,var(--panel) 25%,color-mix(in oklch,var(--panel) 55%,var(--canvas)) 50%,var(--panel) 75%);background-size:300% 100%;animation:shimmer 1.6s ease-in-out infinite}@keyframes shimmer{from{background-position:100% 0}to{background-position:0 0}}.preview-state[data-target=presentation] .sk-strip{display:flex}.preview-state[data-target=presentation] .sk-frame{width:min(100%,calc(50vh * 16 / 9));aspect-ratio:16/9}.preview-state[data-target=app] .skeleton{width:auto}.preview-state[data-target=app] .sk-frame{width:auto;height:min(52vh,520px);aspect-ratio:9/19.5;border-radius:34px;box-shadow:0 0 0 8px var(--panel),0 0 0 9px var(--edge);padding:48px 18px}.preview-note{display:grid;justify-items:center;gap:4px;text-align:center;max-width:520px}#preview-stage{margin:0;font-weight:600}#preview-agent{margin:0}#preview-elapsed{font-variant-numeric:tabular-nums}#preview-elapsed:empty{display:none}#preview-error{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--reddb-color-feedback-danger-foreground)}#preview-retry{margin-top:8px}.canvas[data-phase=error] .skeleton{display:none}.canvas[data-phase=empty] :is(.sk-strip,.sk-frame) i{animation:none}#no-variants{font-size:11px;opacity:.75}@media(prefers-reduced-motion:reduce){.canvas[data-phase=ready] .preview-pane{transition:none}.sk-strip i,.sk-frame i{animation:none}}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;min-height:0}#tab-review{white-space:nowrap}.tab-count{display:inline-block;margin-left:6px;min-width:18px;padding:0 6px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:600;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}#panel-review{display:flex;flex-direction:column;padding:0;overflow:hidden;--ok:var(--reddb-color-feedback-success-foreground);--warn:var(--reddb-color-feedback-warning-foreground);--bad:var(--reddb-color-feedback-danger-foreground);--info:var(--reddb-color-feedback-info-foreground);--mono:var(--reddb-font-family-mono,ui-monospace,monospace)}.review-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 16px 16px;display:flex;flex-direction:column}.review-scroll>:not([hidden])~*{margin-top:12px}.review-scroll>.fold+.fold{margin-top:0}.review-scroll>p{margin:0}#rounds{display:grid;gap:6px;min-width:0}.round-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;min-width:0}.round-head h2{font-size:15px;margin:0;white-space:nowrap}.round-tally{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}#rounds-only{margin-left:auto;flex:none;min-height:0;padding:1px 10px;border-radius:999px;font-size:12px;line-height:18px;color:var(--muted);background:transparent}#rounds-only:hover{color:var(--ink)}#rounds-only[aria-pressed=true]{border-color:var(--ink);color:var(--ink);font-weight:600}.round-sub{margin:0;font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 10px;overflow-wrap:anywhere}.round-sub:empty{display:none}.round-sub a,.row-evidence,.round-left a{color:var(--accent)}.round-alert{margin:0;padding:6px 10px;border:1px solid var(--bad);border-radius:var(--reddb-radius-md);background:var(--reddb-color-feedback-danger-surface,transparent);font-size:12px;overflow-wrap:anywhere}.round-alert strong{color:var(--bad)}.round-message{margin:0;font-size:12px;color:var(--muted);white-space:pre-line;overflow-wrap:anywhere;max-height:4.5em;overflow:hidden}.round-message strong{color:var(--ink);font-weight:600}#rounds-list{display:grid;min-width:0}#rounds-list>.rows,#rounds-list>.round-left{margin-bottom:10px}.rows{list-style:none;margin:0;padding:0;border-top:1px solid var(--edge);min-width:0}.rows>li{border-bottom:1px solid var(--edge);min-width:0}#rounds[data-only=true] .rows[data-block=current]>li[data-left=false]{display:none}.row-toggle{width:100%;display:grid;grid-template-columns:14px 18px 44px minmax(0,1fr);gap:6px;align-items:start;padding:5px 2px;border:0;border-radius:0;background:transparent;text-align:left;min-height:29px;font-size:13px;line-height:18px;font-weight:400}.row-toggle:hover{background:color-mix(in oklch,var(--ink) 5%,transparent)}.row-toggle:active{background:color-mix(in oklch,var(--ink) 9%,transparent)}.row-toggle:focus-visible{outline-offset:-2px}.row-toggle .num{font:500 11px/18px var(--mono);color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}.row-toggle .tag{font:10px/18px var(--mono);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row-toggle[aria-expanded=true] .row-text{white-space:pre-wrap;overflow-wrap:anywhere}.rows>li[data-status=resolved] .row-text,.rows>li[data-status=accepted] .row-text{color:var(--muted)}.glyph{width:14px;height:14px;display:block;flex:none;color:var(--muted)}.row-toggle .glyph{margin-top:2px}.glyph[data-mark=addressed]{color:var(--info)}.glyph[data-mark=resolved]{color:var(--ok)}.glyph[data-mark=partial]{color:var(--warn)}.glyph[data-mark=unresolved]{color:var(--bad)}.glyph .tick{stroke:var(--surface)}.row-body{padding:0 2px 10px 46px;display:grid;gap:6px;font-size:12px;min-width:0;overflow-wrap:anywhere}.row-body p{margin:0}.row-where{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.row-label{display:block;font:11px/1.45 var(--mono);color:var(--muted);overflow-wrap:anywhere}.row-claim b,.row-outcome b{font-size:11px;font-weight:600;margin-right:6px}.row-claim b{color:var(--info)}.row-outcome[data-status=resolved] b{color:var(--ok)}.row-outcome[data-status=partial] b{color:var(--warn)}.row-outcome[data-status=unresolved] b{color:var(--bad)}.row-outcome[data-status=accepted] b{color:var(--muted)}.row-note,.row-claim>[data-copy=notVerified]{color:var(--muted)}.row-actions{display:flex;gap:6px;flex-wrap:wrap}.row-actions button{min-height:0;padding:1px 8px;font-size:11px;line-height:18px}.row-record{display:grid;gap:6px;padding:8px;border:1px solid var(--edge);border-radius:var(--reddb-radius-md);background:var(--panel)}.row-record label{margin:0;font-size:11px}.row-record select,.row-record input{min-height:26px;padding:2px 6px;font-size:12px}.row-record .row-actions{justify-content:flex-end}.tally{display:inline-flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums}.tally .glyph{width:12px;height:12px}.fold{border-top:1px solid var(--edge);padding:0;min-width:0}.review-scroll details.fold:last-of-type{padding-bottom:0}.fold>summary{display:flex;align-items:baseline;gap:8px;padding:6px 2px;font-size:12px;list-style:none;min-width:0;border-radius:2px}.fold>summary::-webkit-details-marker{display:none}.fold>summary::before{content:"";flex:none;align-self:center;width:5px;height:5px;margin:0 4px 0 3px;border:solid var(--muted);border-width:0 1.5px 1.5px 0;transform:rotate(-45deg)}.fold[open]>summary{margin-bottom:0}.fold[open]>summary::before{transform:rotate(45deg)}.fold>summary:focus-visible{outline-offset:-2px}.fold-side{margin-left:auto;display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-weight:400;white-space:nowrap;font-variant-numeric:tabular-nums}.fold-body{padding:2px 2px 10px 16px}.fold>.rows{margin:0 0 6px 16px}.round-done>summary b,.round-group>summary b{font-weight:600}.round-subhead{margin:8px 0 4px;font-size:11px;color:var(--muted)}.round-left{display:grid;gap:4px}.round-line{margin:0;display:flex;gap:8px;align-items:baseline;font-size:12px}.round-line .fold-side{margin-left:auto}#design-tasks .note{padding:3px 0;border:0;font-size:12px;display:flex;gap:8px;align-items:baseline;flex-wrap:nowrap}#design-tasks .note span{min-width:0;flex:1}#design-tasks .note small{display:inline;flex:none;font-size:11px}#design-tasks .note[data-status=completed] span,#design-tasks .note[data-status=cancelled] span{color:var(--muted)}.reply{display:grid;gap:4px;padding:8px 10px;border:1px solid var(--edge);border-radius:var(--reddb-radius-md);background:var(--panel);font-size:12px;min-width:0}.reply small{font-size:11px}.reply-text{line-height:18px;max-height:54px;overflow:hidden;overflow-wrap:anywhere}.reply[data-expanded=true] .reply-text{max-height:50vh;overflow:auto}.reply-text p{margin:0;min-height:6px}.reply:not([data-expanded=true]) .reply-text p:empty{display:none}.reply-text code{font:11px var(--mono);padding:0 3px;border-radius:3px;background:var(--canvas)}.link{justify-self:start;min-height:0;padding:0;border:0;background:none;color:var(--accent);font-size:12px}.link:hover{background:none;text-decoration:underline}#feed{display:grid;gap:6px;max-height:40vh;overflow:auto}#feed:not(:has(.entry:not([hidden]))) #feed-empty{display:block}#feed-empty{margin:0}#feed:has(.entry:not([hidden])) #feed-empty{display:none}.entry[data-kind=tool][data-status=failed]{color:var(--bad)}.entry p{margin:0;min-height:6px}.entry code{font:11px var(--mono)}#inbox summary{display:flex;align-items:center;gap:8px}#inbox-count{margin-left:auto}.fold-body label{margin-bottom:8px}.composer{flex:none;display:grid;gap:8px;padding:10px 16px 12px;border-top:1px solid var(--edge);background:var(--surface);min-width:0}#note{min-height:52px;height:52px;resize:vertical;padding:6px 9px;font-size:13px;line-height:20px}.composer[data-open=true] #note{min-height:88px}.compose-bar{display:flex;gap:8px;align-items:center;min-width:0}.attach{position:relative;margin:0;display:inline-flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;border:1px solid var(--edge);border-radius:var(--reddb-radius-md);color:var(--muted);cursor:pointer}.attach:hover{color:var(--ink);border-color:var(--muted)}.attach:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:3px}.attach:has(input:disabled){opacity:.45;cursor:default}.attach svg{display:block}.sends{display:flex;gap:8px;flex:1;min-width:0}.sends>*{min-width:0}#send{flex:1 1 auto;margin:0}#send-end{flex:0 1 auto;white-space:nowrap}.hints{font-size:11px;color:var(--muted)}#feedback-status{margin:0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}#notes{display:grid;max-height:min(30vh,180px);overflow:auto;margin:0;border-top:1px solid var(--edge)}#notes:empty{display:none}.draft{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;padding:4px 0;border-bottom:1px solid var(--edge);font-size:12px;min-width:0}.draft:hover,.draft:focus-within{background:color-mix(in oklch,var(--panel) 60%,transparent)}.draft-tag{flex:none;max-width:84px;font:10px/18px var(--mono);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.draft-text{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.draft button{flex:none;min-height:0;padding:0 7px;font-size:11px;line-height:18px}.draft .note-orphaned{font-size:10px;font-weight:600;padding:0 6px;border-radius:4px;border:1px solid currentColor;color:var(--bad)}@container(max-width:860px){aside>.tabs{gap:14px}}@container(max-width:640px){.review-scroll{padding:12px}.composer{padding:8px 12px;gap:6px}.composer:not([data-open=true]){grid-template-columns:minmax(0,1fr) auto;align-items:center}.composer:not([data-open=true])>:is(#notes,#feedback-status){grid-column:1/-1}.composer:not([data-open=true]) #note{min-height:32px;height:32px;resize:none;overflow:hidden;padding-top:5px;padding-bottom:5px;line-height:20px}.composer:not([data-open=true]) :is(.hints,.attach,#send-end){display:none}#notes{max-height:72px}}
:host{--ok:var(--reddb-color-feedback-success-foreground);--warn:var(--reddb-color-feedback-warning-foreground);--bad:var(--reddb-color-feedback-danger-foreground)}#toolbar .rev-chip{display:inline-flex;align-items:center;gap:6px;flex:none;padding:3px 9px;font-size:12px;font-weight:600;white-space:nowrap;color:var(--ink)}#toolbar .rev-chip:disabled{opacity:1}.rev-chip:not([data-action=true]){cursor:default}.rev-chip:not([data-action=true]):hover{background:var(--surface);border-color:var(--edge)}.rev-chip .dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--ok)}.rev-chip[data-chip=behind],.rev-chip[data-chip=offline]{border-color:var(--warn)}.rev-chip[data-chip=behind] .dot{background:transparent;border:2px solid var(--warn)}.rev-chip[data-chip=offline] .dot{background:var(--warn);border-radius:1px;height:2px;width:9px}.rev-chip[data-chip=updating] .dot{background:transparent;border:2px solid var(--accent);border-right-color:transparent;animation:spin .8s linear infinite}.rev-chip[data-chip=failed]{border-color:var(--bad);color:var(--bad)}.rev-chip[data-chip=failed] .dot{background:var(--bad);border-radius:1px}.stage{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--canvas)}.stage>.canvas{flex:1 1 auto}.revision-line{flex:none;margin:12px 16px 0;padding:5px 10px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;font-size:12px;line-height:18px;border:1px solid var(--edge);border-left-width:3px;border-radius:var(--reddb-radius-md);background:var(--surface);color:var(--ink);overflow-wrap:anywhere;min-width:0}.revision-line[data-tone=warn]{border-color:var(--warn)}.revision-line[data-tone=bad]{border-color:var(--bad)}.revision-line[data-tone=ok]{border-left-color:var(--ok)}.revision-line b{font-weight:600}.revision-line span{color:var(--muted)}.revision-line button{margin-left:auto;min-height:0;padding:1px 10px;font-size:12px;line-height:18px;font-weight:600}.round-progress{display:grid;gap:5px;min-width:0}.steps{display:grid;grid-template-columns:repeat(5,1fr);gap:3px}.steps i{height:4px;border-radius:2px;background:var(--edge)}.steps i[data-s=done]{background:color-mix(in oklch,var(--ink) 70%,var(--edge))}.steps i[data-s=now]{background:var(--accent)}.steps[data-tone=halt] i[data-s=now]{background:var(--warn)}.steps[data-tone=ready] i{background:var(--ok)}.round-stage{margin:0;font-size:12px;min-width:0;overflow-wrap:anywhere}#round-stage b{font-weight:600}#round-stage span{color:var(--muted)}.round-live{display:flex;align-items:center;gap:8px;min-width:0}.round-live>.live{flex:0 1 auto}#round-received{display:block;margin-left:auto;flex:none;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}.live{margin:0;display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);min-width:0}.live .dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--muted)}.live[data-state=working] .dot{background:var(--accent);animation:pulse 1.6s ease-in-out infinite}.live[data-state=offline],.live[data-state=waiting]{color:var(--warn)}
.live[data-state=waiting] .dot{background:var(--warn)}
.live[data-state=failed]{color:var(--bad)}
.live[data-state=failed] .dot{background:var(--bad)}.live[data-state=offline] .dot{background:var(--warn);border-radius:1px;height:2px;width:9px}.live>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.action-dialog [data-newer]{margin:0 0 12px;padding:6px 10px;border:1px solid var(--warn);border-radius:var(--reddb-radius-md);font-size:12px}@keyframes pulse{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){.live .dot,.rev-chip .dot{animation:none}}@container(max-width:640px){.revision-line{margin:8px 12px 0}#toolbar :is(#designs,#revisions){flex:1 1 88px}}
    </style><header id="toolbar"><h1>${options.appearance ? `<img src="${options.appearance.favicon}" alt="RedDB">` : ""}<span data-copy="title">${copy.title}</span></h1><select id="designs" aria-label="${copy.alternatives}" data-copy-aria-label="alternatives"></select><div id="revision-tools" class="tools" hidden><select id="revisions" aria-label="${copy.history}" data-copy-aria-label="history"></select><button type="button" id="newer" class="rev-chip" data-chip="latest" hidden><i class="dot" aria-hidden="true"></i><span id="newer-label"></span></button></div><div class="actions"><div id="review-tools" class="tools" hidden><button type="button" id="annotate" aria-pressed="false" aria-label="${copy.annotate}" data-copy-aria-label="annotate" title="${copy.annotateShortcut}" data-copy-title="annotateShortcut">${icons.annotate}<span class="label" data-copy="annotateShort">${copy.annotateShort}</span></button><select id="width" aria-label="${copy.width}" data-copy-aria-label="width"><option value="100%" data-copy="full">${copy.full}</option><option value="390" data-copy="mobile">${copy.mobile}</option><option value="768" data-copy="tablet">${copy.tablet}</option><option value="1440" data-copy="desktop">${copy.desktop}</option></select><span class="segment" id="device-switch" role="group" aria-label="${copy.devicePlatform}" data-copy-aria-label="devicePlatform" hidden><button type="button" id="device-ios" aria-pressed="false"><span data-copy="platformIos">${copy.platformIos}</span></button><button type="button" id="device-android" aria-pressed="false"><span data-copy="platformAndroid">${copy.platformAndroid}</span></button></span><button id="restore" hidden title="${copy.restore}" data-copy-title="restore" aria-label="${copy.restore}" data-copy-aria-label="restore"><span data-copy="restore">${copy.restore}</span></button><button type="button" id="present" hidden><span data-copy="present">${copy.present}</span></button><button id="approve" class="primary"><span data-copy="approve">${copy.approve}</span></button><button id="reopen" hidden><span data-copy="reopen">${copy.reopen}</span></button></div><button type="button" id="refresh" class="icon" aria-label="${copy.refresh}" data-copy-aria-label="refresh" title="${copy.refresh}" data-copy-title="refresh">${icons.refresh}</button><div class="menu-host" id="menu-host"><button type="button" id="more" class="icon" aria-label="${copy.more}" data-copy-aria-label="more" title="${copy.more}" data-copy-title="more" aria-haspopup="menu" aria-expanded="false" aria-controls="menu">${icons.more}</button><div id="menu" role="menu" aria-label="${copy.more}" data-copy-aria-label="more" hidden><button type="button" role="menuitem" id="share"><span data-copy="share">${copy.share}</span></button><button type="button" role="menuitem" id="new"><span data-copy="create">${copy.create}</span></button><button type="button" role="menuitem" id="menu-refresh" data-for="refresh"><span data-copy="refresh">${copy.refresh}</span></button><button type="button" role="menuitem" id="menu-add-variant" data-for="add-variant"><span data-copy="addVariant">${copy.addVariant}</span></button><button type="button" role="menuitem" id="organize-variants"><span data-copy="organizeVariants">${copy.organizeVariants}</span></button></div></div></div></header>
    <section id="intake" hidden><form class="intake" id="create"><h2><span data-copy="create">${copy.create}</span></h2><label><span data-copy="name">${copy.name}</span><input id="name" required></label><div class="row"><label><span data-copy="journey">${copy.journey}</span><select id="journey"><option value="new" data-copy="new">${copy.new}</option><option value="existing" data-copy="existing">${copy.existing}</option></select></label><label><span data-copy="engine">${copy.engine}</span><select id="engine"><option value="html">HTML</option><option value="react">React</option><option value="solid">Solid</option></select></label></div><div class="row"><label><span data-copy="designTarget">${copy.designTarget}</span><select id="design-target"><option value="web" data-copy="targetWeb">${copy.targetWeb}</option><option value="app" data-copy="targetApp">${copy.targetApp}</option><option value="presentation" data-copy="targetPresentation">${copy.targetPresentation}</option></select></label><label id="design-platform-field" hidden><span data-copy="designPlatform">${copy.designPlatform}</span><select id="design-platform"><option value="" data-copy="platformBoth">${copy.platformBoth}</option><option value="ios" data-copy="platformIos">${copy.platformIos}</option><option value="android" data-copy="platformAndroid">${copy.platformAndroid}</option></select></label></div><label><span data-copy="application">${copy.application}</span><input id="application" value="."></label><label><span data-copy="objective">${copy.objective}</span><textarea id="objective" required></textarea></label><label><span data-copy="audience">${copy.audience}</span><input id="audience"></label><label><span data-copy="constraints">${copy.constraints}</span><textarea id="constraints"></textarea></label><label><span data-copy="references">${copy.references}</span><textarea id="references"></textarea></label><button class="primary"><span data-copy="create">${copy.create}</span></button></form></section>
    <section id="studio"><div class="variant-bar"><div id="variants" class="tabs" role="tablist" aria-label="${copy.variants}" data-copy-aria-label="variants"></div><span id="no-variants" class="muted" data-copy="noVariants">${copy.noVariants}</span><div id="merge-bar" role="group" aria-label="${copy.mergeSelection}" data-copy-aria-label="mergeSelection" hidden><span id="merge-options"></span><button type="button" id="merge-variants" class="primary"><span data-copy="mergeVariants">${copy.mergeVariants}</span></button><button type="button" id="cancel-merge"><span data-copy="cancel">${copy.cancel}</span></button></div><span id="operation-badge" class="op-badge" role="status" hidden></span><span class="spacer"></span><button type="button" id="add-variant" class="icon" aria-label="${copy.addVariant}" data-copy-aria-label="addVariant" title="${copy.addVariant}" data-copy-title="addVariant">${icons.add}</button><div class="menu-host" id="variant-menu-host"><button type="button" id="variant-actions" aria-label="${copy.variantActions}" data-copy-aria-label="variantActions" title="${copy.variantActions}" data-copy-title="variantActions" aria-haspopup="menu" aria-expanded="false" aria-controls="variant-menu" hidden>${icons.more}<span class="label" data-copy="variantActions">${copy.variantActions}</span></button><div id="variant-menu" role="menu" aria-label="${copy.variantActions}" data-copy-aria-label="variantActions" hidden><button type="button" role="menuitem" id="run-anti-slop"><span data-copy="runAntiSlop">${copy.runAntiSlop}</span></button><button type="button" role="menuitem" id="rename-variant"><span data-copy="renameVariant">${copy.renameVariant}</span></button><button type="button" role="menuitem" id="split-variant"><span data-copy="splitVariant">${copy.splitVariant}</span></button><button type="button" role="menuitem" id="delete-variant"><span data-copy="deleteVariant">${copy.deleteVariant}</span></button><button type="button" role="menuitem" id="move-left"><span data-copy="moveLeft">${copy.moveLeft}</span></button><button type="button" role="menuitem" id="move-right"><span data-copy="moveRight">${copy.moveRight}</span></button><button type="button" role="menuitem" id="select-merge"><span data-copy="selectMerge">${copy.selectMerge}</span></button><button type="button" role="menuitem" id="menu-newer" data-for="newer"><span data-copy="latest">${copy.latest}</span></button><button type="button" role="menuitem" id="menu-reopen" data-for="reopen"><span data-copy="reopen">${copy.reopen}</span></button></div></div><span class="segment"><button type="button" id="view-single" class="icon" aria-pressed="true" aria-label="${copy.single}" data-copy-aria-label="single" title="${copy.single}" data-copy-title="single">${icons.single}</button><button type="button" id="view-compare" class="icon" aria-pressed="false" aria-label="${copy.sideBySide}" data-copy-aria-label="sideBySide" title="${copy.sideBySide}" data-copy-title="sideBySide">${icons.compare}</button></span></div><main><div class="stage" id="stage"><p id="revision-line" class="revision-line" role="status" hidden></p><div class="canvas" id="canvas" data-phase="loading"><div id="preview-state" class="preview-state" data-target="web"><div class="skeleton" aria-hidden="true"><div class="sk-strip"><i></i><i></i><i></i><i></i><i></i></div><div class="sk-frame"><i></i><i></i><i></i></div></div><div class="preview-note"><p id="preview-stage" role="status" aria-live="polite"></p><p id="preview-agent" class="muted" aria-live="polite" hidden></p><small id="preview-elapsed" class="muted" aria-hidden="true"></small><p id="preview-error" role="alert" hidden></p><button type="button" id="preview-retry" hidden><span data-copy="previewRetry">${copy.previewRetry}</span></button></div></div><section class="preview-pane" id="primary-pane" role="tabpanel"><div class="pane-label" id="primary-label" hidden></div><div id="screen-bar" class="screen-bar" hidden><span class="muted" id="screens-label" data-copy="screens">${copy.screens}</span><div id="screens" class="tabs" role="tablist" aria-label="${copy.screens}" data-copy-aria-label="screens"></div><span id="slide-count" class="muted" aria-live="polite" hidden></span></div><div class="viewport"><div class="device" id="preview-device"><div class="device-chrome"></div><iframe id="preview" title="${copy.review}" data-copy-title="review" sandbox="allow-scripts allow-forms" allow=""></iframe></div><div id="card" hidden role="dialog" aria-labelledby="card-label"><header><span id="card-label"></span><button type="button" id="card-close" aria-label="${copy.closeCard}" data-copy-aria-label="closeCard" title="${copy.closeCard}" data-copy-title="closeCard">×</button></header><textarea id="card-text" aria-label="${copy.cardNote}" data-copy-aria-label="cardNote"></textarea><small class="muted" data-copy="cardHint">${copy.cardHint}</small><div class="row"><button type="button" id="card-add" class="primary"><span data-copy="add">${copy.add}</span></button></div></div></div></section><section class="preview-pane" id="peer-pane" hidden><label class="pane-label"><span data-copy="compareVariant">${copy.compareVariant}</span><select id="peer-variant"></select></label><div class="viewport"><div class="device" id="peer-preview-device"><div class="device-chrome"></div><iframe id="peer-preview" title="${copy.compareVariant}" data-copy-title="compareVariant" sandbox="allow-scripts allow-forms" allow=""></iframe></div></div></section></div></div><aside><div class="tabs" role="tablist" aria-label="${copy.review}"><button type="button" role="tab" id="tab-review" aria-controls="panel-review" aria-selected="true" tabindex="0"><span data-copy="feedback">${copy.feedback}</span><span id="rounds-count" class="tab-count" data-open="false" hidden>0</span></button><button type="button" role="tab" id="tab-assets" aria-controls="panel-assets" aria-selected="false" tabindex="-1"><span data-copy="assets">${copy.assets}</span></button><button type="button" role="tab" id="tab-details" aria-controls="panel-details" aria-selected="false" tabindex="-1"><span data-copy="details">${copy.details}</span></button><button type="button" role="tab" id="tab-params" aria-controls="panel-params" aria-selected="false" tabindex="-1"><span data-copy="params">${copy.params}</span></button></div><section class="panel" role="tabpanel" id="panel-review" aria-labelledby="tab-review"><div class="review-scroll" id="review-scroll"><p id="agent-state" class="live" hidden><i class="dot" aria-hidden="true"></i><span id="agent-text"></span></p><p id="review-state" class="muted"></p><div id="operation-state" role="alert" hidden><span id="operation-error"></span><button type="button" id="retry-operation"><span data-copy="operationRetry">${copy.operationRetry}</span></button></div><p id="approval-reselect" data-copy="approvalReselect" hidden>${copy.approvalReselect}</p><section id="rounds" aria-labelledby="round-title" data-only="false" hidden><div class="round-head"><h2 id="round-title"></h2><span id="round-tally" class="round-tally" aria-live="polite"></span><button type="button" id="rounds-only" class="chip" aria-pressed="false"><span data-copy="onlyLeft">${copy.onlyLeft}</span></button></div><div id="round-progress" class="round-progress"><div id="round-steps" class="steps" role="img"><i></i><i></i><i></i><i></i><i></i></div><p class="round-stage"><span id="round-stage" aria-live="polite"></span></p><div id="round-live" class="round-live"><small id="round-received"></small></div></div><p id="round-sub" class="round-sub"></p><p id="round-alert" class="round-alert" role="status" hidden></p><p id="round-message" class="round-message" dir="auto" hidden></p><div id="rounds-list"></div></section><details id="design-tasks-section" class="fold"><summary><span data-copy="tasks">${copy.tasks}</span><span id="tasks-count" class="fold-side"></span></summary><div id="design-tasks" class="fold-body" aria-live="polite"></div></details><div id="reply" class="reply" hidden><small id="reply-head"></small><div id="reply-text" class="reply-text" dir="auto"></div><button type="button" id="reply-more" class="link" aria-expanded="false" aria-controls="reply-text" hidden></button></div><details id="activity" class="fold" hidden><summary><span data-copy="activity">${copy.activity}</span><span id="activity-count" class="fold-side"></span></summary><div id="feed" class="fold-body" role="log" aria-live="polite" hidden><p id="feed-empty" class="muted" data-copy="feedEmpty">${copy.feedEmpty}</p></div></details><details id="approved-record" class="fold" hidden><summary data-copy="approvalDetails">${copy.approvalDetails}</summary><pre id="approved-details" class="fold-body"></pre></details><details id="inbox" class="fold"><summary><span data-copy="findings">${copy.findings}</span><span id="inbox-count" data-open="false">0</span></summary><div class="fold-body"><p id="inbox-empty" class="muted" data-copy="inboxEmpty">${copy.inboxEmpty}</p><div id="inbox-list"></div><button type="button" id="queue-fixes" hidden><span data-copy="queueFixes">${copy.queueFixes}</span></button></div></details><details class="fold"><summary><span data-copy="diagram">${copy.diagram}</span></summary><div class="fold-body"><label><span data-copy="diagram">${copy.diagram}</span><textarea id="selection"></textarea></label><button type="button" id="whiteboard"><span data-copy="whiteboard">${copy.whiteboard}</span></button></div></details><small id="target" hidden></small></div><div class="composer" id="composer"><div id="notes"></div><p id="feedback-status" role="status" aria-live="polite" aria-atomic="true" hidden></p><div id="pending-actions" class="row" hidden><button type="button" id="discard-pending"><span data-copy="discardPending">${copy.discardPending}</span></button><button type="button" id="reload-resend"><span data-copy="reloadResend">${copy.reloadResend}</span></button></div><textarea id="note" rows="2" aria-label="${copy.notes}" data-copy-aria-label="notes" placeholder="${copy.messageHint}" data-copy-placeholder="messageHint"></textarea><div class="compose-bar"><label class="attach" title="${copy.attachment}" data-copy-title="attachment">${icons.attach}<input id="attachment" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" aria-label="${copy.attachment}" data-copy-aria-label="attachment"></label><div class="sends"><button id="send" class="primary"><span data-copy="send">${copy.send}</span></button><button id="send-end"><span data-copy="sendEnd">${copy.sendEnd}</span></button></div></div><small class="hints"><span id="send-hint" data-copy="sendHint">${copy.sendHint}</span> · <span id="draft" data-copy="draft">${copy.draft}</span></small><small id="round-open" class="hints" data-copy="roundOpen" hidden>${copy.roundOpen}</small></div></section><section class="panel" role="tabpanel" id="panel-assets" aria-labelledby="tab-assets" hidden><details open><summary><span data-copy="assets">${copy.assets}</span></summary><div id="assets"></div></details><details open><summary><span data-copy="export">${copy.export}</span></summary><button id="html"><span data-copy="html">${copy.html}</span></button><button id="pdf" hidden><span data-copy="pdf">${copy.pdf}</span></button><button id="audit"><span data-copy="audit">${copy.audit}</span></button><label><span data-copy="implementation">${copy.implementation}</span><input id="implementation" value="dist"></label><button id="compare"><span data-copy="compare">${copy.compare}</span></button><label><span data-copy="source">${copy.source}</span><select id="svg"></select></label><div class="row"><label><span data-copy="duration">${copy.duration}</span><input id="duration" type="number" min="0.1" max="10" step="0.1" value="3"></label><label><span data-copy="fps">${copy.fps}</span><input id="fps" type="number" min="1" max="25" value="20"></label></div><label><span data-copy="size">${copy.size}</span><input id="size" type="number" min="16" max="1024" value="512"></label><label class="check"><input type="checkbox" id="transparent"><span data-copy="transparent">${copy.transparent}</span></label><button id="gif"><span data-copy="gif">${copy.gif}</span></button></details><details open><summary><span data-copy="jobs">${copy.jobs}</span></summary><div id="jobs"></div></details>
    </section><section class="panel" role="tabpanel" id="panel-details" aria-labelledby="tab-details" hidden>
    <label id="platform-field" hidden><span data-copy="designPlatform">${copy.designPlatform}</span><select id="platform"><option value="" data-copy="platformBoth">${copy.platformBoth}</option><option value="ios" data-copy="platformIos">${copy.platformIos}</option><option value="android" data-copy="platformAndroid">${copy.platformAndroid}</option></select><small class="muted" data-copy="platformHint">${copy.platformHint}</small></label>
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
    <p class="muted" data-copy="paramPublish">${copy.paramPublish}</p></div></div></section></aside></main></section><dialog id="board-dialog" style="width:95vw;height:90vh;max-width:1400px"><button id="board-close"><span data-copy="close">${copy.close}</span></button><iframe id="board-frame" title="${copy.whiteboard}" data-copy-title="whiteboard" sandbox="allow-scripts" style="height:calc(100% - 50px);width:100%"></iframe></dialog><dialog id="anti-slop-dialog" class="action-dialog" aria-labelledby="anti-slop-heading"><h2 id="anti-slop-heading" data-copy="runAntiSlop">${copy.runAntiSlop}</h2><p id="anti-slop-variant"></p><p data-copy="antiSlopScope">${copy.antiSlopScope}</p><label><span data-copy="antiSlopFocus">${copy.antiSlopFocus}</span><textarea id="anti-slop-text" maxlength="4000"></textarea></label><div class="row"><button type="button" id="cancel-anti-slop" data-copy="cancel">${copy.cancel}</button><button type="button" id="confirm-anti-slop" class="primary" data-copy="runAntiSlop">${copy.runAntiSlop}</button></div></dialog><dialog id="approve-dialog" class="action-dialog" aria-labelledby="approve-heading"><h2 id="approve-heading" data-copy="confirm">${copy.confirm}</h2><p id="approval-revision"></p><p data-copy="approvalScope">${copy.approvalScope}</p><label class="check"><input type="checkbox" id="approval-screenshot" checked><span data-copy="approvalScreenshot">${copy.approvalScreenshot}</span></label><div id="approval-review" hidden><p class="muted" data-copy="approvalReviewNotes">${copy.approvalReviewNotes}</p><ul id="approval-review-list"></ul></div><div id="approval-open" hidden><p class="muted" data-copy="approvalOpenNotes">${copy.approvalOpenNotes}</p><ul id="approval-open-list"></ul></div><div class="row"><button id="cancel-approve" data-copy="cancel">${copy.cancel}</button><button id="record-approve" data-copy="approvalRecordAll" hidden>${copy.approvalRecordAll}</button><button id="confirm-approve" class="primary" data-copy="approveAction">${copy.approveAction}</button></div></dialog><dialog id="variant-dialog" class="action-dialog" aria-labelledby="variant-heading"><form id="variant-form"><h2 id="variant-heading" data-copy="addVariant">${copy.addVariant}</h2><p data-copy="variantHint">${copy.variantHint}</p><label><span data-copy="variantPrompt">${copy.variantPrompt}</span><textarea id="variant-prompt" required></textarea></label><div class="row"><button type="button" id="cancel-variant" data-copy="cancel">${copy.cancel}</button><button type="submit" id="request-variant" class="primary" data-copy="requestVariant">${copy.requestVariant}</button></div></form></dialog><dialog id="operation-dialog" class="action-dialog" aria-labelledby="operation-heading"><form id="operation-form"><h2 id="operation-heading"></h2><p id="operation-subject"></p><p id="operation-hint"></p><label id="operation-name-field"><span data-copy="renameLabel">${copy.renameLabel}</span><input id="operation-name" maxlength="100"></label><label id="operation-text-field"><span data-copy="operationGuidance">${copy.operationGuidance}</span><textarea id="operation-text" maxlength="2000"></textarea></label><div class="row"><button type="button" id="cancel-operation" data-copy="cancel">${copy.cancel}</button><button type="submit" id="confirm-operation" class="primary"></button></div></form></dialog><dialog id="restore-dialog" class="action-dialog" aria-labelledby="restore-heading"><h2 id="restore-heading"></h2><div class="row"><button type="button" id="cancel-restore" data-copy="cancel">${copy.cancel}</button><button type="button" id="confirm-restore" class="primary" data-copy="restore">${copy.restore}</button></div></dialog><div id="status" role="status" aria-live="polite"></div>`

  for (const id of ["approve-dialog", "variant-dialog", "operation-dialog", "anti-slop-dialog"]) {
    const notice = document.createElement("p")
    notice.dataset.actionStatus = ""
    notice.setAttribute("role", "status")
    notice.setAttribute("aria-live", "polite")
    // An open dialog holds a newer revision back; this says so inside it, where the reader is looking.
    const newer = document.createElement("p")
    newer.dataset.newer = ""
    newer.dataset.copy = "dialogNewer"
    newer.textContent = copy.dialogNewer
    newer.hidden = true
    element(id).querySelector("h2")!.after(newer)
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
      "pdf",
      "audit",
      "gif",
      "compare",
    ])
      element<HTMLButtonElement>(id).disabled ||=
        !state.revision ||
        !!state.failedPreview ||
        (!!state.design?.ended && !["html", "pdf", "audit", "gif", "compare"].includes(id))
    element<HTMLButtonElement>("param-save").disabled ||=
      !state.revision || !!state.failedPreview || state.revision !== state.design?.revision || !!state.design?.ended
    // A revision the feed announced is newer than the one on screen even before the design list has it.
    element<HTMLButtonElement>("approve").disabled ||=
      state.revision !== state.design?.revision || !!state.pendingOperation || !!liveness.announced
    element<HTMLButtonElement>("confirm-approve").disabled ||=
      !state.revision ||
      !!state.failedPreview ||
      state.revision !== state.design?.revision ||
      !!state.design?.ended ||
      !!state.pendingOperation ||
      !!liveness.announced
    // Variant operations change the latest revision only, one at a time, while the review is open.
    const blocked = operationBlocked()
    const index = state.variants.findIndex((item) => item.id === state.variant)
    for (const id of ["rename-variant", "split-variant", "delete-variant", "select-merge", "run-anti-slop"])
      element<HTMLButtonElement>(id).disabled = blocked || index < 0
    element<HTMLButtonElement>("run-anti-slop").disabled ||= !!state.pending
    element<HTMLButtonElement>("confirm-anti-slop").disabled = state.working || !state.revision || !!state.design?.ended
    input("anti-slop-text").disabled = !!state.pending?.review || state.working
    // The last remaining variant cannot be deleted.
    element<HTMLButtonElement>("delete-variant").disabled ||= state.variants.length < 2
    // The active tab's own delete "x" follows the same guard, but working/preview state can flip
    // without a variant redraw, so it is re-synced here rather than only at creation time.
    const closeTab = root.getElementById("variant-close") as HTMLButtonElement | null
    if (closeTab) closeTab.hidden = blocked
    element<HTMLButtonElement>("move-left").disabled = blocked || index <= 0
    element<HTMLButtonElement>("move-right").disabled = blocked || index < 0 || index >= state.variants.length - 1
    element<HTMLButtonElement>("merge-variants").disabled = blocked || state.mergePick.length < 2
    element<HTMLButtonElement>("confirm-operation").disabled = blocked || !!renameProblem()
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
      item.hidden =
        target.hidden ||
        (target.closest<HTMLElement>("#studio")?.hidden ?? false) ||
        // The revision chip is always on screen; its menu entry only while the chip has something to do.
        (target.id === "newer" && target.dataset.action !== "true")
    })
  const selectVariant = (id: string) => {
    if (state.working || state.failedPreview) return
    const screen = currentScreen()
    state.variant = id
    // Comparing directions step by step: stay on the same screen when the new variant has it.
    if (screen && screen !== currentScreen()) selectScreen(screen)
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
    // Said once the revision is on screen, not over its loading state.
    element("no-variants").hidden = items.length > 0 || loading.view.phase !== "ready"
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
    // The tab's own delete affordance exists whenever there is more than one variant; controls()
    // hides it while blocked, the same guard the delete-variant menu item uses, so it stays in
    // sync even when only state.working (not the variant list) changes.
    const deletable = items.length > 1
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
          // Delete opens the same confirmation the variant-actions menu offers, on the focused tab.
          if (event.key === "Delete") {
            event.preventDefault()
            openOperation("delete", [item.id])
            return
          }
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
        const wrap = document.createElement("span")
        wrap.className = "variant-tab"
        wrap.append(button)
        // Only the active tab offers a delete "x", on hover/focus (always visible on touch/narrow widths).
        if (item.id === state.variant && deletable) {
          const close = document.createElement("button")
          close.type = "button"
          close.id = "variant-close"
          close.className = "variant-close"
          close.hidden = operationBlocked()
          close.setAttribute("aria-label", `${copy.deleteVariantTab} ${item.name}`)
          close.textContent = "×"
          close.addEventListener("click", (event) => {
            event.stopPropagation()
            openOperation("delete", [item.id])
          })
          wrap.append(close)
        }
        return wrap
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
    drawScreens()
    drawNotes()
    controls()
  }
  /** Screens belong to the selected variant, or to the page when that variant has none of its own. */
  const screenScope = () => (state.screens.some((item) => item.variant === state.variant) ? state.variant : "")
  const currentScreen = () => state.screenCurrent[screenScope()] ?? ""
  const selectScreen = (id: string, variant = screenScope()) => {
    if (!state.screens.some((item) => item.id === id && item.variant === variant)) return false
    state.screenCurrent = { ...state.screenCurrent, [variant]: id }
    element<HTMLIFrameElement>("preview").contentWindow?.postMessage({ type: "design:screen", id, variant }, "*")
    drawScreens()
    return true
  }
  const presenting = () => state.design?.target === "presentation"
  const drawScreens = () => {
    const scope = screenScope()
    const items = state.screens.filter((item) => item.variant === scope)
    const current = currentScreen()
    const slides = presenting()
    // One screen needs no switcher; the page behaves as before. A deck always shows its slides and counter.
    element("screen-bar").hidden = slides ? !items.length : items.length < 2
    element("screen-bar").dataset.slides = String(slides)
    element("screens-label").textContent = slides ? copy.slides : copy.screens
    element("screens-label").dataset.copy = slides ? "slides" : "screens"
    element("slide-count").hidden = !slides
    const at = items.findIndex((item) => item.id === current)
    element("slide-count").textContent = slides && at >= 0 ? `${at + 1} / ${items.length}` : ""
    if (slides) return drawStrip(items, current)
    state.strip = ""
    element("screens").replaceChildren(
      ...(items.length < 2 ? [] : items).map((item, index) => {
        const button = document.createElement("button")
        button.type = "button"
        button.id = `screen-${item.id}`
        button.textContent = item.name
        button.setAttribute("role", "tab")
        button.setAttribute("aria-controls", "preview")
        button.setAttribute("aria-selected", String(item.id === current))
        button.tabIndex = item.id === current ? 0 : -1
        button.addEventListener("click", () => selectScreen(item.id))
        button.onkeydown = (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length
          selectScreen(items[next].id)
          element(`screen-${items[next].id}`).focus()
        }
        return button
      }),
    )
    syncPeerScreen()
  }
  /**
   * A deck's thumbnail strip: one small live frame per slide, each opened on its slide. The frames are
   * rebuilt only when the revision or its slides change, since re-inserting a frame reloads it; moving
   * between slides only moves the selection.
   */
  const drawStrip = (items: { id: string; name: string }[], current: string) => {
    const key = JSON.stringify([state.revision, state.variant, items.map((item) => item.id)])
    if (state.strip !== key) {
      state.strip = key
      element("screens").replaceChildren(
        ...items.map((item, index) => {
          const thumb = document.createElement("div")
          thumb.className = "thumb"
          const mini = document.createElement("iframe")
          mini.setAttribute("sandbox", "allow-scripts")
          mini.setAttribute("aria-hidden", "true")
          mini.tabIndex = -1
          mini.title = item.name
          // A framework can mount its slides after load, so the slide is asked for again a moment later.
          const show = () => {
            mini.contentWindow?.postMessage({ type: "design:variant", id: state.variant }, "*")
            mini.contentWindow?.postMessage({ type: "design:screen", id: item.id, scroll: false }, "*")
          }
          mini.onload = () => {
            show()
            setTimeout(show, 500)
          }
          mini.srcdoc = state.html
          const button = document.createElement("button")
          button.type = "button"
          button.id = `screen-${item.id}`
          button.setAttribute("role", "tab")
          button.setAttribute("aria-controls", "preview")
          button.setAttribute("aria-label", item.name)
          button.title = item.name
          const number = document.createElement("span")
          number.textContent = String(index + 1)
          button.append(number)
          button.addEventListener("click", () => selectScreen(item.id))
          button.onkeydown = (event) => {
            const next = options.deck?.().step({ key: event.key, shift: event.shiftKey }, index, items.length)
            if (next === undefined || event.key === " ") return
            event.preventDefault()
            selectScreen(items[next].id)
            element(`screen-${items[next].id}`).focus()
          }
          thumb.append(mini, button)
          return thumb
        }),
      )
    }
    for (const item of items) {
      const button = element(`screen-${item.id}`)
      button.setAttribute("aria-selected", String(item.id === current))
      button.tabIndex = item.id === current ? 0 : -1
      if (item.id === current) button.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
    syncPeerScreen()
  }
  /** Moves a presentation to the slide a navigation key names; false for any other key or design. */
  const stepSlide = (key: string, shift: boolean) => {
    if (!presenting() || !options.deck) return false
    const items = state.screens.filter((item) => item.variant === screenScope())
    const next = options.deck().step(
      { key, shift },
      items.findIndex((item) => item.id === currentScreen()),
      items.length,
    )
    return next !== undefined && selectScreen(items[next].id)
  }
  /** The side-by-side frame follows the switcher when its variant has the same screen. */
  const syncPeerScreen = () => {
    const screen = currentScreen()
    if (!state.comparing || !screen) return
    const scope = state.screens.some((item) => item.variant === state.peer) ? state.peer : ""
    if (state.screens.some((item) => item.id === screen && item.variant === scope))
      element<HTMLIFrameElement>("peer-preview").contentWindow?.postMessage(
        { type: "design:screen", id: screen, variant: scope, scroll: false },
        "*",
      )
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
    ...(currentScreen() ? { screen: currentScreen() } : {}),
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
          feedbackError: state.feedbackError,
          approvalScreenshot: state.approvalScreenshot,
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
  const reveal = (target: string, pulse = true, screen?: string) => {
    const variant = variantOf(target)
    const peer = !!variant && state.comparing && variant === state.peer
    // A note taken on another variant shows that variant first; the frame only scrolls.
    if (!peer && variant && variant !== state.variant && state.variants.some((item) => item.id === variant))
      selectVariant(variant)
    // A note taken on another screen opens that screen before the frame looks for its element.
    if (!peer && screen && screen !== currentScreen()) selectScreen(screen)
    element<HTMLIFrameElement>(peer ? "peer-preview" : "preview").contentWindow?.postMessage(
      { type: "design:reveal", target, pulse },
      "*",
    )
  }
  const highlight = (target: string) => {
    for (const id of ["preview", "peer-preview"])
      element<HTMLIFrameElement>(id).contentWindow?.postMessage({ type: "design:highlight", target }, "*")
  }
  const action = (name: keyof ReviewCopy, onclick: () => void, part?: string) => {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.copy = name
    if (part) button.dataset.part = part
    button.textContent = copy[name]
    button.onclick = onclick
    return button
  }
  /** Whether the preview can show a note's element; a note on the whole page or a diagram has none. */
  const locatable = (target: string) =>
    !["", "page", "diagram"].includes(target.replace(/^variant:[a-zA-Z0-9_-]{1,64} /, ""))
  /** Reveals a listed note's element and remembers it, so a revision without that element can say so. */
  const revealNote = (target: string, screen?: string) => {
    feedbackView.revealing = target
    reveal(target, true, screen)
  }
  /** Writes text only when it changed: an unchanged poll must not touch the panel (live regions re-announce writes). */
  const write = (node: Element, value: string) => {
    if (node.textContent !== value) node.textContent = value
  }
  /** Puts nodes in order under a parent, moving only misplaced ones, so unchanged rows keep focus and state. */
  const place = (parent: Element, nodes: Node[]) => {
    nodes.forEach((node, index) => {
      if (parent.childNodes[index] !== node) parent.insertBefore(node, parent.childNodes[index] ?? null)
    })
    while (parent.childNodes.length > nodes.length) parent.lastChild!.remove()
  }
  /** A page served on a loopback address runs next to its terminal; any other host has no transcript beside it. */
  const local =
    /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(location.hostname) || location.hostname.endsWith(".localhost")
  /** Feedback panel disclosures the reader opened or closed, kept per design; the tab and row expansion are not. */
  const sectionsKey = () => `redcode:design:${endpoint}:${state.design?.id}:sections`
  const sections = (): Record<string, unknown> => {
    try {
      const stored = JSON.parse(localStorage.getItem(sectionsKey()) ?? "{}")
      return stored && typeof stored === "object" ? stored : {}
    } catch {
      return {}
    }
  }
  const disclose = (node: HTMLDetailsElement, id: string, fallback: boolean) => {
    const stored = sections()[id]
    const open = typeof stored === "boolean" ? stored : fallback
    // A disclosure the page opens or closes itself is not the reader's choice and is not stored.
    if (node.open !== open) {
      node.dataset.quiet = ""
      node.open = open
    }
    node.ontoggle = () => {
      if (node.dataset.quiet !== undefined) return void delete node.dataset.quiet
      try {
        localStorage.setItem(sectionsKey(), JSON.stringify({ ...sections(), [id]: node.open }))
      } catch {
        // Without storage the disclosure still works for this visit.
      }
    }
  }
  const draftRows = new Map<string, { signature: string; row: HTMLElement }>()
  /** The notes queued for the next message, one line each; unchanged rows are kept across redraws. */
  const drawNotes = () => {
    const seen = new Map<string, number>()
    const rows = state.notes.map((note, index) => {
      const base = `${note.target}\n${note.text}`
      const id = `${base}\n${seen.get(base) ?? 0}`
      seen.set(base, (seen.get(base) ?? 0) + 1)
      // A deck's note names its slide, which Reveal opens before it finds the element.
      const slide =
        presenting() && note.params?.screen
          ? (state.screens.find((item) => item.id === note.params?.screen)?.name ?? note.params.screen)
          : ""
      // A note on a variant that is gone from the revision on screen says so and offers a new home.
      const from = variantOf(note.target)
      // Only once an operation has settled: a note moved during a provisional change could not be moved back.
      const orphaned =
        !state.pendingOperation &&
        !!from &&
        state.variants.length > 0 &&
        !state.variants.some((item) => item.id === from)
      const destination = orphaned
        ? (state.variants.find((item) => item.id === state.retarget[from!]) ??
          state.variants.find((item) => item.id === state.variant) ??
          state.variants[0])
        : undefined
      const signature = JSON.stringify([note, index, slide, destination?.id ?? "", destination?.name ?? ""])
      const previous = draftRows.get(id)
      if (previous?.signature === signature) return previous.row
      const row = document.createElement("div")
      row.className = "draft"
      row.dataset.draft = String(index)
      const tag = document.createElement("span")
      tag.className = "draft-tag"
      tag.textContent = slide || note.tag || ""
      tag.title = note.label || note.target
      const text = document.createElement("span")
      text.className = "draft-text"
      text.dir = "auto"
      text.textContent = note.text
      text.title = note.text
      row.append(tag, text)
      if (locatable(note.target)) row.append(action("reveal", () => revealNote(note.target, note.params?.screen)))
      row.append(
        action("remove", () => {
          if (state.pending) return
          state.notes.splice(index, 1)
          save()
          drawNotes()
        }),
      )
      if (destination) {
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
        row.append(mark, move)
      }
      if (locatable(note.target)) {
        row.addEventListener("mouseenter", () => highlight(note.target))
        row.addEventListener("focusin", () => highlight(note.target))
      }
      row.addEventListener("mouseleave", () => highlight(""))
      row.addEventListener("focusout", (event) => {
        if (!row.contains(event.relatedTarget as Node | null)) highlight("")
      })
      draftRows.set(id, { signature, row })
      return row
    })
    for (const [id, item] of draftRows) if (!rows.includes(item.row)) draftRows.delete(id)
    place(element("notes"), rows)
    element<HTMLButtonElement>("send").textContent = state.pending ? copy.retry : copy.send
    element("send").dataset.copy = state.pending ? "retry" : "send"
    element("feedback-status").hidden = !state.pending
    element("feedback-status").textContent = state.pending
      ? state.feedbackError
        ? `${copy.feedbackFailed} ${state.feedbackError}`
        : copy.feedbackSaved
      : ""
    element("feedback-status").dataset.tone = state.feedbackError ? "error" : "info"
    // A refused message (a 409 conflict, say) holds newer revisions back until it is sent, discarded or resent.
    element("pending-actions").hidden = !state.pending || !state.feedbackError
    // A plain end is refused while any round has notes without an outcome (DesignRounds.open); a message with
    // notes may end the review, which the server then defers until every note has an outcome.
    const blocked = openNotes().length > 0 && !state.notes.length
    element("send-end").hidden = !!state.pending || blocked
    element("round-open").hidden = !blocked || !!state.pending
    input("note").disabled = !!state.pending
  }
  type Mark = Design.NoteStatus | "addressed"
  const markCopy = {
    open: "statusOpen",
    addressed: "statusAddressed",
    resolved: "statusResolved",
    partial: "statusPartial",
    unresolved: "statusUnresolved",
    accepted: "statusAccepted",
  } as const
  const statusCopy = (status: Design.NoteStatus) => markCopy[status]
  /** The agent's "I changed this" is shown apart from open, but it is not an outcome: the note stays open. */
  const markOf = (note: Design.Note): Mark => (note.status === "open" && note.addressed ? "addressed" : note.status)
  const noteKey = (note: { feedback: string; index: number }) => `${note.feedback}#${note.index}`
  /**
   * A note is settled once it has a final outcome, or once a partial or unresolved outcome was sent again in a later
   * note; otherwise it is left to act on. Judged from statuses alone: a published revision settles nothing.
   */
  const settledBy = (notes: readonly Design.Note[]) => {
    const resent = new Set(notes.flatMap((note) => (note.item.resent ? [noteKey(note.item.resent)] : [])))
    return {
      resent,
      settled: (note: Design.Note) =>
        note.status === "resolved" ||
        note.status === "accepted" ||
        (note.status !== "open" && resent.has(noteKey(note))),
    }
  }
  const svg = (name: string, attributes: Record<string, string | number>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
    return node
  }
  /** One shape per status so it reads without its colour: ring, ring with a dot, tick, half, cross, dash. */
  const glyph = (mark: Mark) => {
    const node = svg("svg", {
      viewBox: "0 0 14 14",
      class: "glyph",
      role: "img",
      "data-mark": mark,
      "aria-label": copy[markCopy[mark]],
      "data-copy-aria-label": markCopy[mark],
    })
    const line = { fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round" }
    node.append(
      svg("circle", {
        cx: 7,
        cy: 7,
        r: 5.5,
        fill: mark === "resolved" ? "currentColor" : "none",
        stroke: "currentColor",
        "stroke-width": 1.5,
      }),
    )
    if (mark === "addressed") node.append(svg("circle", { cx: 7, cy: 7, r: 2.5, fill: "currentColor" }))
    if (mark === "partial") node.append(svg("path", { d: "M7 1.5a5.5 5.5 0 0 1 0 11z", fill: "currentColor" }))
    if (mark === "unresolved") node.append(svg("path", { d: "M5 5l4 4M9 5l-4 4", ...line }))
    if (mark === "accepted") node.append(svg("path", { d: "M4.5 7h5", ...line }))
    if (mark === "resolved")
      node.append(svg("path", { d: "M4.2 7.2l1.9 1.9 3.7-4", class: "tick", ...line, "stroke-width": 1.6 }))
    return node
  }
  /** Glyph counts for a round's summary line, final outcomes first. */
  const tallies = (notes: readonly Design.Note[]) =>
    (["resolved", "partial", "unresolved", "accepted", "addressed", "open"] as const).flatMap((mark) => {
      const count = notes.filter((note) => markOf(note) === mark).length
      if (!count) return []
      const node = document.createElement("span")
      node.className = "tally"
      node.append(glyph(mark), String(count))
      return [node]
    })
  const noteCount = (count: number) =>
    count === 1 ? copy.noteCountOne : copy.noteCount.replace("{{count}}", String(count))
  /**
   * What the Feedback panel keeps outside the DOM: rows a status change rebuilds read their expansion and a
   * half-typed reason from here, and rows and round blocks are reused while their signature holds.
   */
  const feedbackView = {
    expanded: new Set<string>(),
    closing: new Map<string, { status: string; reason: string }>(),
    only: false,
    hovered: "",
    revealing: "",
    rows: new Map<string, { signature: string; row: HTMLElement }>(),
    blocks: new Map<string, { signature: string; node: HTMLElement; lists: Map<number, HTMLElement> }>(),
  }
  /** One note as a checklist row: a single toggle line, and below it the element, the agent's claim, the outcome and actions. */
  const noteRow = (
    note: Design.Note,
    ordinal: number,
    origin: Design.Note | undefined,
    again: boolean,
    left: boolean,
  ) => {
    const key = noteKey(note)
    const id = `note-${hash(key)}`
    const mark = markOf(note)
    const target = note.item.target
    const row = document.createElement("li")
    row.dataset.note = key
    row.dataset.status = mark
    row.dataset.left = String(left)
    const toggle = document.createElement("button")
    toggle.type = "button"
    toggle.className = "row-toggle"
    toggle.dataset.part = "toggle"
    toggle.setAttribute("aria-controls", id)
    const number = document.createElement("span")
    number.className = "num"
    number.textContent = String(ordinal)
    const tag = document.createElement("span")
    tag.className = "tag"
    tag.textContent = locatable(target) ? (note.item.tag ?? "") : ""
    const words = document.createElement("span")
    words.className = "row-text"
    words.dir = "auto"
    words.textContent = note.item.text
    toggle.append(glyph(mark), number, tag, words)
    const body = document.createElement("div")
    body.className = "row-body"
    body.id = id
    const paragraph = (className: string, ...parts: (string | Node)[]) => {
      const node = document.createElement("p")
      node.className = className
      node.append(...parts)
      return node
    }
    const copied = (tag: string, name: keyof ReviewCopy, prefix = "", suffix = "") => {
      const node = document.createElement(tag)
      node.dataset.copy = name
      if (prefix) node.dataset.copyPrefix = prefix
      if (suffix) node.dataset.copySuffix = suffix
      node.textContent = `${prefix}${copy[name]}${suffix}`
      return node
    }
    // The element by what the reviewer saw: the selection, else the tag and its text. A form control's text is its
    // typed value and an empty text says nothing, so those are named by the breadcrumb below instead.
    const control = ["input", "select", "textarea"].includes(note.item.tag ?? "")
    const where = note.item.selectedText
      ? `“${cut(note.item.selectedText.replace(/\s+/g, " ").trim(), 200)}”`
      : !control && note.item.elementText
        ? `${note.item.tag ? `${note.item.tag} ` : ""}“${note.item.elementText}”`
        : ""
    if (where) {
      const node = paragraph("row-where", where)
      node.dir = "auto"
      body.append(node)
    }
    const breadcrumb = document.createElement("code")
    breadcrumb.className = "row-label"
    breadcrumb.textContent = note.item.label || target
    body.append(breadcrumb)
    if (note.addressed) {
      const summary = document.createElement("span")
      summary.dir = "auto"
      summary.textContent = note.addressed.summary
      body.append(
        paragraph(
          "row-claim",
          copied("b", "rowAgent"),
          summary,
          ...(note.status === "open" ? [copied("span", "notVerified", " · ")] : []),
        ),
      )
    }
    if (note.status === "open" && !note.addressed) body.append(paragraph("row-note", copied("span", "noteWaiting")))
    if (note.status !== "open") {
      const outcome = paragraph("row-outcome", copied("b", markCopy[note.status]))
      outcome.dataset.status = note.status
      if (note.reason) {
        const reason = document.createElement("span")
        reason.dir = "auto"
        reason.textContent = note.reason
        outcome.append(reason)
      }
      if (note.by === "reviewer") outcome.append(copied("span", "byReviewer", " · "))
      body.append(outcome)
    }
    // A re-sent note names the round it came from, so its outcomes read as one chain.
    if (origin) body.append(paragraph("row-note", copied("span", "resentFrom", "", ` ${origin.round}`)))
    if (note.evidence?.job) {
      const link = copied("a", "openReport") as HTMLAnchorElement
      link.className = "row-evidence"
      link.dataset.part = "evidence"
      link.href = `${endpoint}/${encodeURIComponent(state.design!.id)}/job/${encodeURIComponent(note.evidence.job)}/file`
      link.target = "_blank"
      link.rel = "noopener"
      body.append(paragraph("", link))
    }
    const actions = document.createElement("div")
    actions.className = "row-actions"
    if (locatable(target))
      actions.append(action("reveal", () => revealNote(target, note.item.params?.screen), "reveal"))
    // A note the agent could not settle goes into the next round as it was, on the revision on screen.
    if (again)
      actions.append(
        action(
          "resend",
          () => {
            if (state.pending || !state.revision) return
            if (!state.notes.some((item) => item.target === target && item.text === note.item.text)) {
              state.notes.push({
                ...note.item,
                revision: state.revision,
                resent: { feedback: note.feedback, index: note.index },
              })
              save()
              drawNotes()
            }
            status(copy.resendQueued, "resendQueued", "success")
          },
          "resend",
        ),
      )
    body.append(actions)
    // The reviewer's escape hatch: an open note can be closed by hand, as unresolved or accepted with a reason,
    // when the agent cannot verify it (no browser, a crashed renderer).
    const form = note.status === "open" ? document.createElement("form") : undefined
    const close = form ? action("closeByHand", () => {}, "close") : undefined
    const show = () => {
      const expanded = feedbackView.expanded.has(key)
      toggle.setAttribute("aria-expanded", String(expanded))
      body.hidden = !expanded
      if (!form || !close) return
      form.hidden = !feedbackView.closing.has(key)
      close.setAttribute("aria-expanded", String(!form.hidden))
    }
    if (form && close) {
      form.className = "row-record"
      form.id = `${id}-record`
      close.setAttribute("aria-controls", form.id)
      actions.append(close)
      const pick = document.createElement("select")
      pick.dataset.part = "record-status"
      pick.setAttribute("aria-label", copy.recordAs)
      for (const [value, name] of [
        ["unresolved", "recordUnresolved"],
        ["accepted", "recordAccepted"],
      ] as const) {
        const option = document.createElement("option")
        option.value = value
        option.dataset.copy = name
        option.textContent = copy[name]
        pick.append(option)
      }
      const why = document.createElement("input")
      why.type = "text"
      why.maxLength = 500
      why.dataset.part = "reason"
      why.placeholder = copy.recordReason
      why.setAttribute("aria-label", `${copy.recordReason}: ${note.item.text}`)
      const draft = feedbackView.closing.get(key)
      if (draft) {
        pick.value = draft.status
        why.value = draft.reason
      }
      pick.onchange = () => {
        const entry = feedbackView.closing.get(key)
        if (entry) entry.status = pick.value
      }
      why.oninput = () => {
        const entry = feedbackView.closing.get(key)
        if (entry) entry.reason = why.value
      }
      const submit = document.createElement("button")
      submit.type = "submit"
      submit.className = "primary"
      submit.dataset.copy = "record"
      submit.dataset.part = "record"
      submit.textContent = copy.record
      const buttons = document.createElement("div")
      buttons.className = "row-actions"
      buttons.append(
        action(
          "cancel",
          () => {
            feedbackView.closing.delete(key)
            show()
            close.focus()
          },
          "cancel",
        ),
        submit,
      )
      form.append(pick, why, buttons)
      body.append(form)
      close.onclick = () => {
        if (feedbackView.closing.has(key)) feedbackView.closing.delete(key)
        else feedbackView.closing.set(key, { status: pick.value, reason: why.value })
        show()
        if (!form.hidden) pick.focus()
      }
      form.onsubmit = (event) => {
        event.preventDefault()
        const reason = why.value.trim()
        if (!reason) {
          status(copy.recordReasonRequired, "recordReasonRequired", "error")
          why.focus()
          return
        }
        void run(async () => {
          await api(`/${state.design!.id}`, "PATCH", {
            by: "reviewer",
            notes: [{ feedback: note.feedback, index: note.index, status: pick.value, reason }],
          })
          feedbackView.closing.delete(key)
          await refresh()
          status(copy.recorded, "recorded", "success")
        }, submit).then(() => {
          if (feedbackView.closing.has(key)) return
          element("rounds-list")
            .querySelector<HTMLElement>(`[data-note="${CSS.escape(key)}"] [data-part=toggle]`)
            ?.focus()
        })
      }
    }
    toggle.onclick = () => {
      if (feedbackView.expanded.has(key)) feedbackView.expanded.delete(key)
      else feedbackView.expanded.add(key)
      show()
    }
    show()
    // Pointing at a row or moving focus into it outlines its element in the preview.
    if (locatable(target)) {
      const on = () => {
        feedbackView.hovered = key
        highlight(target)
      }
      const off = () => {
        if (feedbackView.hovered !== key) return
        feedbackView.hovered = ""
        highlight("")
      }
      row.addEventListener("mouseenter", on)
      row.addEventListener("mouseleave", off)
      row.addEventListener("focusin", on)
      row.addEventListener("focusout", (event) => {
        if (!row.contains(event.relatedTarget as Node | null)) off()
      })
    }
    row.append(toggle, body)
    return row
  }
  /**
   * The Feedback panel's rounds: the newest as a checklist, older rounds with notes left to act on showing those
   * notes, settled rounds as one summary line each, and settled rounds beyond the last three grouped. Rows and blocks
   * are keyed so the 5 s poll leaves focus, expansion and a half-typed reason alone.
   */
  const drawRounds = () => {
    const rounds = state.design?.rounds ?? []
    const notes = state.design?.notes ?? []
    const open = openNotes().length
    write(element("rounds-count"), String(open))
    element("rounds-count").hidden = !open
    element("rounds-count").dataset.open = String(open > 0)
    element("rounds").hidden = !rounds.length
    const active = root.activeElement instanceof HTMLElement ? root.activeElement : undefined
    const holder = active?.closest<HTMLElement>("#rounds-list [data-note]")
    const { resent, settled } = settledBy(notes)
    const rowKeys = new Set<string>()
    const blockKeys = new Set<string>()
    const ofRound = (round: Design.Round) => notes.filter((note) => note.round === round.number)
    const rowsOf = (round: Design.Round, only: (note: Design.Note) => boolean = () => true) =>
      ofRound(round).flatMap((note, position) => {
        if (!only(note)) return []
        const key = noteKey(note)
        const origin = note.item.resent ? notes.find((item) => noteKey(item) === noteKey(note.item.resent!)) : undefined
        const again =
          (note.status === "partial" || note.status === "unresolved") && !!round.published && !resent.has(key)
        const signature = JSON.stringify([note, position + 1, origin?.round ?? 0, again, settled(note)])
        rowKeys.add(key)
        const previous = feedbackView.rows.get(key)
        if (previous?.signature === signature) return [previous.row]
        const row = noteRow(note, position + 1, origin, again, !settled(note))
        feedbackView.rows.set(key, { signature, row })
        return [row]
      })
    const list = (name: string) => {
      const node = document.createElement("ul")
      node.className = "rows"
      node.dataset.block = name
      return node
    }
    const summary = (label: HTMLElement, side: (string | Node)[]) => {
      const node = document.createElement("summary")
      const aside = document.createElement("span")
      aside.className = "fold-side"
      aside.append(...side)
      node.append(label, aside)
      return node
    }
    const roundLabel = (tag: string, number: number) => {
      const node = document.createElement(tag)
      node.dataset.copy = "round"
      node.dataset.copySuffix = ` ${number}`
      node.textContent = `${copy.round} ${number}`
      return node
    }
    const block = (
      key: string,
      signature: string,
      build: () => { node: HTMLElement; lists: Map<number, HTMLElement> },
      rows: [number, HTMLElement[]][],
    ) => {
      const previous = feedbackView.blocks.get(key)
      const current = previous?.signature === signature ? previous : { signature, ...build() }
      feedbackView.blocks.set(key, current)
      blockKeys.add(key)
      for (const [number, items] of rows) place(current.lists.get(number)!, items)
      return current.node
    }
    const newest = [...rounds].reverse()
    const grouped = newest.slice(3).filter((round) => ofRound(round).every(settled))
    const blocks = newest.flatMap((round, position) => {
      const own = ofRound(round)
      const marks = own.map(markOf)
      if (position === 0)
        return [
          block(
            "current",
            JSON.stringify([round.number]),
            () => {
              const node = list("current")
              return { node, lists: new Map([[round.number, node]]) }
            },
            [[round.number, rowsOf(round)]],
          ),
        ]
      const left = own.filter((note) => !settled(note)).length
      if (left)
        return [
          block(
            `left:${round.number}`,
            JSON.stringify([round.number, left, own.length, marks]),
            () => {
              const node = document.createElement("div")
              node.className = "round-left"
              const line = document.createElement("p")
              line.className = "round-line"
              const side = document.createElement("span")
              side.className = "fold-side"
              side.append(
                copy.leftOf.replace("{{left}}", String(left)).replace("{{count}}", String(own.length)),
                ...tallies(own),
              )
              line.append(roundLabel("b", round.number), side)
              const rows = list(`left:${round.number}`)
              node.append(line, rows)
              return { node, lists: new Map([[round.number, rows]]) }
            },
            [[round.number, rowsOf(round, (note) => !settled(note))]],
          ),
        ]
      if (grouped.length > 1 && grouped.includes(round)) return []
      return [
        block(
          `done:${round.number}`,
          JSON.stringify([round.number, own.length, marks]),
          () => {
            const node = document.createElement("details")
            node.className = "fold round-done"
            node.dataset.round = String(round.number)
            const rows = list(`done:${round.number}`)
            node.append(summary(roundLabel("b", round.number), [noteCount(own.length), ...tallies(own)]), rows)
            disclose(node, `round-${round.number}`, false)
            return { node, lists: new Map([[round.number, rows]]) }
          },
          [[round.number, rowsOf(round)]],
        ),
      ]
    })
    if (grouped.length > 1) {
      const numbers = grouped.map((round) => round.number)
      const own = grouped.flatMap(ofRound)
      // A range only when it has no gap; a round in between with notes left is listed on its own above.
      const contiguous = numbers.every((number, index) => index === 0 || numbers[index - 1] === number + 1)
      blocks.push(
        block(
          "group",
          JSON.stringify([numbers, own.length, own.map(markOf)]),
          () => {
            const node = document.createElement("details")
            node.className = "fold round-group"
            const label = document.createElement("b")
            label.textContent = contiguous
              ? copy.roundRange.replace("{{first}}", String(numbers.at(-1))).replace("{{last}}", String(numbers[0]))
              : copy.roundsEarlier.replace("{{count}}", String(numbers.length))
            const content = document.createElement("div")
            content.className = "fold-body"
            const lists = new Map<number, HTMLElement>()
            for (const round of grouped) {
              const head = document.createElement("p")
              head.className = "round-subhead"
              head.append(roundLabel("span", round.number), ` · ${noteCount(ofRound(round).length)}`)
              const rows = list(`group:${round.number}`)
              lists.set(round.number, rows)
              content.append(head, rows)
            }
            node.append(summary(label, [noteCount(own.length), ...tallies(own)]), content)
            disclose(node, "group", false)
            return { node, lists }
          },
          grouped.map((round) => [round.number, rowsOf(round)]),
        ),
      )
    }
    place(element("rounds-list"), blocks)
    for (const key of feedbackView.blocks.keys()) if (!blockKeys.has(key)) feedbackView.blocks.delete(key)
    for (const key of feedbackView.rows.keys()) {
      if (rowKeys.has(key)) continue
      feedbackView.rows.delete(key)
      feedbackView.expanded.delete(key)
      feedbackView.closing.delete(key)
      // A row that leaves the list takes its highlight in the preview with it.
      if (feedbackView.hovered !== key) continue
      feedbackView.hovered = ""
      highlight("")
    }
    // A rebuilt or moved row gets its focus back on the same control.
    if (holder && active && root.activeElement !== active) {
      const next = element("rounds-list").querySelector<HTMLElement>(
        `[data-note="${CSS.escape(holder.dataset.note!)}"] [data-part="${active.dataset.part ?? "toggle"}"]`,
      )
      next?.focus({ preventScroll: true })
      if (next instanceof HTMLInputElement) next.setSelectionRange(next.value.length, next.value.length)
    }
    drawConversation()
  }
  /** The newest round's heading: its number, how many notes are left, and the revision and verify report answering it. */
  const drawHead = () => {
    const round = state.design?.rounds?.at(-1)
    if (!round) return
    const all = state.design?.notes ?? []
    const notes = all.filter((note) => note.round === round.number)
    const { settled } = settledBy(all)
    const left = notes.filter((note) => !settled(note)).length
    const title = element("round-title")
    title.dataset.copy = "round"
    title.dataset.copySuffix = ` ${round.number}`
    write(title, `${copy.round} ${round.number}`)
    const rest = feedbackView.only
      ? copy.hiddenCount.replace("{{count}}", String(notes.length - left))
      : left
        ? copy.leftCount.replace("{{count}}", String(left))
        : copy.nothingLeft
    write(element("round-tally"), `${noteCount(notes.length)} · ${rest}`)
    if (element("rounds").dataset.only !== String(feedbackView.only)) {
      element("rounds").dataset.only = String(feedbackView.only)
      element("rounds-only").setAttribute("aria-pressed", String(feedbackView.only))
    }
    const verified = state.feed.findLast(
      (event) => event.type === "verified" && event.design === state.design?.id && event.round === round.number,
    )
    const job =
      verified?.type === "verified" ? verified.job : notes.findLast((note) => note.evidence?.job)?.evidence?.job
    const sub = element("round-sub")
    // Send & end with notes keeps the review open for this round; the line says so until the review ends.
    const ending = !!state.design?.endRequested && !state.design.ended
    const answered = round.published ? revisionName(round.published) : ""
    const signature = JSON.stringify([answered, job ?? "", ending])
    if (sub.dataset.signature === signature) return
    sub.dataset.signature = signature
    const end = document.createElement("span")
    end.dataset.copy = "endingAfterRound"
    end.textContent = copy.endingAfterRound
    // Before an answer the progress line says where the round stands; this line names the answer and its captures.
    if (!round.published) return sub.replaceChildren(...(ending ? [end] : []))
    const answer = document.createElement("span")
    answer.dataset.copy = "roundAnswered"
    answer.dataset.copySuffix = ` ${answered}`
    answer.textContent = `${copy.roundAnswered}${answer.dataset.copySuffix}`
    sub.replaceChildren(answer, ...(ending ? [end] : []))
    if (!job) return
    const report = document.createElement("a")
    report.href = `${endpoint}/${encodeURIComponent(state.design!.id)}/job/${encodeURIComponent(job)}/file`
    report.target = "_blank"
    report.rel = "noopener"
    report.dataset.copy = "openReport"
    report.textContent = copy.openReport
    sub.append(report)
  }
  /** The agent's reply with its light markdown: **bold**, `code` and list lines as typed; never links or markup. */
  const markdown = (text: string) =>
    text.split("\n").map((line) => {
      const paragraph = document.createElement("p")
      for (const part of line.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/)) {
        if (!part) continue
        const strong = /^\*\*[^*\n]+\*\*$/.test(part)
        if (!strong && !/^`[^`\n]+`$/.test(part)) {
          paragraph.append(part)
          continue
        }
        const node = document.createElement(strong ? "strong" : "code")
        node.textContent = strong ? part.slice(2, -2) : part.slice(1, -1)
        paragraph.append(node)
      }
      return paragraph
    })
  const conversationView = { reply: "", message: "", alert: "" }
  /** Offers "Show more" only when the clamped reply hides something. */
  const fitReply = () => {
    const expanded = element("reply").dataset.expanded === "true"
    const more = element("reply-more")
    more.hidden = !expanded && element("reply-text").scrollHeight <= element("reply-text").clientHeight + 1
    more.dataset.copy = expanded ? "replyLess" : "replyMore"
    write(more, expanded ? copy.replyLess : copy.replyMore)
    more.setAttribute("aria-expanded", String(expanded))
  }
  const replyFit = new ResizeObserver(fitReply)
  replyFit.observe(element("reply-text"))
  element("reply-more").onclick = () => {
    element("reply").dataset.expanded = String(element("reply").dataset.expanded !== "true")
    fitReply()
  }
  /**
   * The conversation as the panel shows it: the agent's last reply, this round's message, a refused status recording
   * as an alert on the round, and Activity limited to the entries since the round's first message. Entries are
   * scoped by position, not time: replayed entries carry their message's time and live ones the event's.
   */
  const drawConversation = () => {
    if (!options.feed) return
    const round = state.design?.rounds?.at(-1)
    const keys = state.feed.map(entryKey)
    const start = round ? keys.indexOf(`user:${round.feedback[0]}`) : -1
    const earlier = new Set(keys.slice(0, Math.max(start, 0)))
    element("feed")
      .querySelectorAll<HTMLElement>(".entry")
      .forEach((row) => {
        const hide = earlier.has(row.dataset.key ?? "")
        if (row.hidden !== hide) row.hidden = hide
      })
    const scoped = state.feed.slice(Math.max(start, 0))
    const failed = scoped.filter((event) => event.type === "tool" && event.status === "failed").length
    write(
      element("activity-count"),
      [
        scoped.length === 1 ? copy.activityCountOne : copy.activityCount.replace("{{count}}", String(scoped.length)),
        ...(failed ? [copy.activityFailed.replace("{{count}}", String(failed))] : []),
      ].join(" · "),
    )
    drawHead()
    const recording =
      start >= 0
        ? scoped.findLast(
            (event) => event.type === "tool" && event.tool === "design_document" && event.status !== "running",
          )
        : undefined
    const refused = recording?.type === "tool" && recording.status === "failed" ? recording.summary : ""
    element("round-alert").hidden = !refused
    if (conversationView.alert !== refused) {
      conversationView.alert = refused
      const head = document.createElement("strong")
      head.dataset.copy = "statusRefused"
      head.dataset.copySuffix = ":"
      head.textContent = `${copy.statusRefused}:`
      element("round-alert").replaceChildren(...(refused ? [head, ` ${refused}`] : []))
    }
    // The text typed beside the notes is the round's message, not a note.
    const message = (round?.feedback ?? [])
      .flatMap((id) =>
        state.feed.flatMap((event) => (event.type === "user" && event.id === id && event.text ? [event.text] : [])),
      )
      .join("\n")
    element("round-message").hidden = !message
    if (conversationView.message !== message) {
      conversationView.message = message
      const who = document.createElement("strong")
      who.dataset.copy = "you"
      who.dataset.copySuffix = ": "
      who.textContent = `${copy.you}: `
      element("round-message").replaceChildren(...(message ? [who, message] : []))
    }
    const reply = state.feed.findLast((event) => event.type === "reply")
    element("reply").hidden = !reply
    const signature = reply?.type === "reply" ? JSON.stringify([reply.id, reply.at, reply.text]) : ""
    if (conversationView.reply === signature || reply?.type !== "reply") return
    if (JSON.parse(conversationView.reply || "[]")[0] !== reply.id) element("reply").dataset.expanded = "false"
    conversationView.reply = signature
    const head = element("reply-head")
    head.dataset.copy = "agentReply"
    head.dataset.copySuffix = ` · ${new Date(reply.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    head.textContent = `${copy.agentReply}${head.dataset.copySuffix}`
    element("reply-text").replaceChildren(...markdown(reply.text))
    fitReply()
  }
  element("rounds-only").onclick = () => {
    feedbackView.only = !feedbackView.only
    drawHead()
  }
  // The composer grows while its message is in use. Only focusing the message opens it, and only focus leaving the
  // composer with the message empty closes it: growing on any focus inside would move a draft's Remove or the Send
  // button out from under the pointer between press and release, and the click would be lost.
  element("composer").addEventListener("focusin", (event) => {
    if (event.target === input("note")) element("composer").dataset.open = "true"
  })
  element("composer").addEventListener("focusout", (event) => {
    if (element("composer").contains(event.relatedTarget as Node | null)) return
    element("composer").dataset.open = String(!!input("note").value.trim())
  })
  const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), template)
  const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  /** A duration as the reader says it: seconds, then whole minutes, then whole hours. */
  const span = (ms: number) => {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    if (seconds < 60) return fill(copy.timeSeconds, { count: seconds })
    if (seconds < 3600) return fill(copy.timeMinutes, { count: Math.floor(seconds / 60) })
    return fill(copy.timeHours, { count: Math.floor(seconds / 3600) })
  }
  /**
   * A revision's number in its design's history (R7): its position in the immutable, newest-first revision list,
   * so it needs no stored counter. 0 for a revision the page has not listed yet.
   */
  const ordinal = (id: string) => {
    const index = state.revisions.findIndex((revision) => revision.id === id)
    return index < 0 ? 0 : state.revisions.length - index
  }
  /** R7 for a listed revision, else the tail of its id. */
  const revisionName = (id: string) =>
    ordinal(id) ? fill(copy.chipRevision, { ordinal: ordinal(id) }) : `…${id.slice(-8)}`
  /** The agent's state as far as a connected feed tells it. */
  const agentState = () => (liveness.feed === "live" && state.agent ? state.agent : "unknown")
  /** Revisions newer than the one on screen; a publish the feed announced counts before the list has it. */
  const newerCount = () => {
    const latest = state.design?.revision
    if (!latest || !state.revision) return 0
    const ids = state.revisions.map((revision) => revision.id)
    const listed = latest === state.revision ? 0 : Math.max(ids.indexOf(state.revision) - ids.indexOf(latest), 1)
    const announced =
      !!liveness.announced &&
      liveness.announced !== latest &&
      liveness.announced !== state.revision &&
      !ids.includes(liveness.announced)
    return listed + (announced ? 1 : 0)
  }
  /** What holds a newer revision back from replacing the one on screen; the poll and the line above the preview share it. */
  const blocker = () =>
    state.pending
      ? ("pending" as const)
      : state.card?.text.trim()
        ? ("card" as const)
        : root.querySelector("dialog[open]")
          ? ("dialog" as const)
          : document.hidden
            ? ("hidden" as const)
            : ("" as const)
  const roundStageCopy = {
    received: "stageReceived",
    fixing: "stageFixing",
    stopped: "stageStopped",
    published: "stagePublished",
    unverified: "stageUnverified",
    verifying: "stageVerifying",
    verifyFailed: "stageVerifyFailed",
    recording: "stageRecording",
    missing: "stageMissing",
    recorded: "stageRecorded",
    ready: "stageReady",
  } as const
  const livenessView = { line: "", stage: "" }
  /** The newest round's notes and its newest verify job, the facts its progress is derived from. */
  const roundFacts = (round: Design.Round) => {
    const design = state.design!
    const notes = (design.notes ?? []).filter((note) => note.round === round.number)
    const verify = state.jobs
      .filter(
        (job) =>
          job.input.format === "verify" &&
          // A verify without a round checks the latest one.
          (job.input.round ?? job.verify?.round ?? round.number) === round.number,
      )
      .reduce<Design.Job | undefined>(
        (newest, job) => (!newest || job.created >= newest.created ? job : newest),
        undefined,
      )
    const progress = loader.progress({
      published: !!round.published,
      answered: !!round.published && (!options.feed || liveness.published.has(round.published)),
      notes,
      open: openNotes().length,
      queued: round.feedback.some((id) => liveness.inbox.has(id)),
      inbox: liveness.inbox.size > 0,
      agent: agentState(),
      idle: agentState() === "idle" ? Date.now() - liveness.idleSince : 0,
      verify: verify && { status: verify.status, current: verify.input.revision === design.revision },
      busy: state.jobs.some((job) => job.status === "queued" || job.status === "running"),
      onLatest: !!state.revision && state.revision === design.revision && loading.view.phase === "ready",
      connected: liveness.feed === "live",
    })
    return { notes, verify, progress }
  }
  /** The outcome counts a finished round reports: what the agent marked, not a promise that everything is fixed. */
  const outcomes = (tally: ReturnType<typeof loader.progress>) =>
    (
      [
        ["resolved", "countResolved"],
        ["partial", "countPartial"],
        ["unresolved", "countUnresolved"],
        ["accepted", "countAccepted"],
        ["closed", "countClosed"],
      ] as const
    )
      .flatMap(([name, key]) => (tally[name] ? [fill(copy[key], { count: tally[name] })] : []))
      .join(", ")
  /**
   * The round's progress under its heading: a five-step bar, the stage with its counts, when the round's first
   * message was written, and the agent's live activity. Derived on every poll, feed event and clock tick.
   */
  const drawProgress = () => {
    const design = state.design
    const round = design && !design.ended ? design.rounds?.at(-1) : undefined
    // The live line sits beside when the round was received, or atop the panel when there is no round.
    const slot = round ? element("round-live") : element("review-scroll")
    const agent = element("agent-state")
    if (agent.parentElement !== slot) slot.prepend(agent)
    drawAgent()
    element("round-progress").hidden = !round
    if (!round) return
    const facts = roundFacts(round)
    const progress = facts.progress
    const label = copy[roundStageCopy[progress.stage]]
    const steps = element("round-steps")
    const tone = progress.stage === "ready" ? "ready" : progress.halted ? "halt" : ""
    if (steps.dataset.tone !== tone) steps.dataset.tone = tone
    steps.querySelectorAll("i").forEach((segment, index) => {
      const mark = index < progress.step ? "done" : index === progress.step ? "now" : ""
      if ((segment.dataset.s ?? "") !== mark) segment.dataset.s = mark
    })
    const aria = fill(copy.stepOf, { step: progress.step + 1, stage: label })
    if (steps.getAttribute("aria-label") !== aria) steps.setAttribute("aria-label", aria)
    const left = progress.total - progress.recorded
    const detail = {
      received: round.feedback.some((id) => liveness.inbox.has(id)) ? copy.detailQueued : copy.detailDelivered,
      fixing: progress.addressed
        ? fill(copy.detailAddressed, { done: progress.addressed, count: progress.total })
        : copy.detailWorking,
      stopped:
        progress.total > progress.addressed
          ? fill(copy.detailNotAddressed, { count: progress.total - progress.addressed })
          : copy.detailUnpublished,
      published: copy.detailNotVerified,
      unverified: left ? fill(copy.detailWithout, { count: left }) : outcomes(progress),
      verifying: copy.detailChecking,
      verifyFailed: facts.verify?.error ?? fill(copy.detailWithout, { count: left }),
      recording: fill(copy.detailRecorded, { done: progress.recorded, count: progress.total }),
      missing: fill(copy.detailWithout, { count: left }),
      recorded: outcomes(progress),
      ready: outcomes(progress),
    }[progress.stage]
    const signature = JSON.stringify([label, detail])
    if (livenessView.stage !== signature) {
      livenessView.stage = signature
      const name = document.createElement("b")
      name.textContent = label
      const rest = document.createElement("span")
      rest.textContent = detail ? ` · ${detail}` : ""
      element("round-stage").dataset.stage = progress.stage
      element("round-stage").replaceChildren(name, rest)
    }
    // Replayed entries carry the time their message was written, which is what "received" means here.
    const first = state.feed.find((event) => event.type === "user" && event.id === round.feedback[0])
    write(element("round-received"), fill(copy.receivedAgo, { time: span(Date.now() - (first?.at ?? round.opened)) }))
  }
  /** What the agent is doing beyond idle, from the preview's loading state: activity, a wait or why it stopped. */
  const activityText = (view: LoadingState, now: number) => {
    const detail = view.detail ? `: ${view.detail}` : ""
    const reasons: Record<string, keyof ReviewCopy> = {
      user: "interruptUser",
      shutdown: "interruptShutdown",
      superseded: "interruptSuperseded",
      inactivity: "interruptInactivity",
    }
    if (view.agent === "tool") return fill(copy.agentTool, { tool: view.tool })
    if (view.agent === "thinking") return copy.agentThinking
    if (view.agent === "compacting") return copy.agentCompacting
    if (view.agent === "retrying")
      return `${view.until > now ? fill(copy.agentRetrying, { time: span(view.until - now) }) : copy.agentRetryingNow}${detail}`
    if (view.agent === "permission") return `${copy.agentPermission}${detail}`
    if (view.agent === "failed") return `${copy.agentFailed}${detail}`
    if (view.agent === "interrupted")
      return reasons[view.detail] ? `${copy.agentInterrupted} ${copy[reasons[view.detail]]}` : copy.agentInterrupted
    return ""
  }
  /** The agent's live activity, from live events only; counters freeze while the feed is offline. */
  const drawAgent = () => {
    const node = element("agent-state")
    const now = Date.now()
    const design = state.design
    const review = state.jobs.find(
      (job) =>
        job.input.revision === design?.revision &&
        (job.input.format === "audit" || job.input.format === "verify") &&
        (job.status === "queued" || job.status === "running"),
    )
    const agent = agentState()
    const tool = liveness.tool
    const activity = loading.view.agent
    const waiting = activity === "compacting" || activity === "retrying" || activity === "permission"
    const stopped = activity === "failed" || activity === "interrupted"
    const [kind, text] =
      liveness.feed === "none" || design?.ended
        ? ["", ""]
        : liveness.feed === "unavailable"
          ? ["offline", copy.feedUnavailable]
          : liveness.feed === "offline"
            ? ["offline", copy.liveOffline]
            : liveness.feed === "connecting"
              ? ["", copy.liveConnecting]
              : review
                ? [
                    "working",
                    review.input.format === "audit"
                      ? copy.stateReviewing
                      : fill(copy.liveVerify, { time: span(now - (review.started ?? review.created)) }),
                  ]
                : agent === "working" && waiting
                  ? ["waiting", activityText(loading.view, now)]
                  : agent === "idle" && stopped
                    ? ["failed", activityText(loading.view, now)]
                    : agent === "working"
                      ? [
                          "working",
                          tool
                            ? [fill(copy.liveTool, { tool: tool.name }), span(now - tool.since), tool.summary]
                                .filter(Boolean)
                                .join(" · ")
                            : liveness.last
                              ? fill(copy.liveLast, { time: span(now - liveness.last) })
                              : copy.liveWorking,
                        ]
                      : agent === "idle"
                        ? [
                            "idle",
                            liveness.idleLive
                              ? fill(copy.liveIdleSince, { time: clock(liveness.idleSince) })
                              : copy.liveIdle,
                          ]
                        : ["", ""]
    node.hidden = !text
    if ((node.dataset.state ?? "") !== kind) node.dataset.state = kind
    write(element("agent-text"), text)
  }
  /** The revision chip beside the picker: Latest, N behind, Updating…, Load failed or Offline. */
  const drawChip = (kind: ReturnType<typeof loader.revision>["chip"], count: number) => {
    const chip = element<HTMLButtonElement>("newer")
    chip.hidden = !state.revision
    const text = {
      latest: copy.chipLatest,
      behind: fill(copy.chipBehind, { count }),
      updating: copy.chipUpdating,
      failed: copy.chipFailed,
      offline: copy.chipOffline,
    }[kind]
    const action = kind === "behind" || kind === "failed"
    if (chip.dataset.chip !== kind) chip.dataset.chip = kind
    if (chip.dataset.action !== String(action)) {
      chip.dataset.action = String(action)
      chip.tabIndex = action ? 0 : -1
      syncMenu()
    }
    const number = state.revision ? ordinal(state.revision) : 0
    write(element("newer-label"), number ? `${fill(copy.chipRevision, { ordinal: number })} · ${text}` : text)
    const hint = kind === "offline" ? copy.chipOfflineHint : action ? copy.latest : ""
    if (chip.title !== hint) chip.title = hint
    const label = hint ? `${text}. ${hint}` : text
    if (chip.getAttribute("aria-label") !== label) chip.setAttribute("aria-label", label)
  }
  /** The one line above the preview: facts about the revision on screen, and why a newer one has not replaced it. */
  const drawLine = (kind: ReturnType<typeof loader.revision>["line"], latest: boolean) => {
    const node = element("revision-line")
    const design = state.design
    const round = design?.rounds?.at(-1)
    const created = (id: string | null | undefined) => state.revisions.find((revision) => revision.id === id)?.created
    const shown = state.revisions.find((revision) => revision.id === state.revision)
    const time = shown ? clock(shown.created) : ""
    const when = !latest ? time : time ? fill(copy.lineLatest, { time }) : copy.chipLatest
    const newest = created(design?.revision)
    const progress = round ? roundFacts(round).progress : undefined
    const before = () => {
      if (!progress || !round) return ""
      // Without a connected feed the page cannot tell what the agent is doing, so it says nothing about it.
      if (agentState() === "unknown") return ""
      if (progress.stage === "stopped")
        return progress.total > progress.addressed
          ? fill(copy.lineStopped, { notes: noteCount(progress.total - progress.addressed) })
          : copy.lineStoppedAll
      if (round.feedback.some((id) => liveness.inbox.has(id))) return copy.lineQueued
      return fill(copy.lineWorking, { notes: noteCount(progress.total - progress.recorded) })
    }
    const [bold, why, tone, button] = (
      {
        "": ["", "", "", ""],
        failed: [
          fill(copy.lineFailed, { name: shown ? `${shown.name} · ${shown.id.slice(-8)}` : state.revision }),
          liveness.failure,
          "bad",
          "failed",
        ],
        card: [copy.lineNewer, copy.lineCard, "warn", "card"],
        pending: [copy.lineNewer, copy.linePending, "warn", "pending"],
        older: [
          fill(copy.lineOlder, { time }),
          newest === undefined ? "" : fill(copy.lineOlderWhy, { time: clock(newest) }),
          "",
          "",
        ],
        answers: [
          fill(copy.lineAnswers, { when, round: round?.number ?? "" }),
          "",
          latest && progress?.stage === "ready" ? "ok" : "",
          "",
        ],
        after: [fill(copy.lineAfter, { when, round: round?.number ?? "" }), "", "", ""],
        yours: [fill(copy.lineYours, { round: round?.number ?? "" }), copy.lineYoursWhy, "warn", ""],
        unanswered: [fill(copy.lineUnanswered, { round: round?.number ?? "" }), copy.lineUnansweredWhy, "warn", ""],
        before: [
          fill(copy.lineBefore, { round: round?.number ?? "" }),
          before(),
          progress?.stage === "stopped" ? "warn" : "",
          "",
        ],
      } as const
    )[kind]
    // A newer revision that replaced the one on screen after a wait says when it was published.
    const switched =
      liveness.switched?.revision === state.revision && kind !== "failed" && kind !== "card" && kind !== "pending"
        ? fill(copy.lineSwitched, { time: span(Date.now() - liveness.switched.created) })
        : ""
    const number = shown && (switched || bold) ? ordinal(shown.id) : 0
    const lead = number ? `${fill(copy.chipRevision, { ordinal: number })} · ${switched || bold}` : switched || bold
    const rest = switched ? bold : why
    const signature = JSON.stringify([lead, rest, tone, button])
    node.hidden = !lead
    if (livenessView.line === signature) return
    livenessView.line = signature
    node.dataset.tone = tone
    node.dataset.kind = switched ? "switched" : kind
    const strong = document.createElement("b")
    strong.textContent = lead
    const parts: Node[] = [strong]
    if (rest) {
      const muted = document.createElement("span")
      muted.textContent = rest
      parts.push(muted)
    }
    if (button === "failed") parts.push(action("lineFailedAction", () => void run(retryLatest), "retry-latest"))
    if (button === "card")
      parts.push(
        action(
          "lineCardAction",
          () =>
            void run(async () => {
              // The note belongs to the revision it was written on; it goes into the queue, then the page moves on.
              queueCard()
              if (state.card) closeCard()
              if (state.design?.revision) await chooseRevision(state.design.revision, true)
            }),
          "add-and-switch",
        ),
      )
    if (button === "pending")
      parts.push(
        action("linePendingAction", () => void run(() => send(false), element("send")), "retry-send"),
        action("discardPending", () => void run(async () => discardPending(false)), "discard-send"),
      )
    const focused = node.contains(root.activeElement) ? (root.activeElement as HTMLElement).dataset.part : undefined
    node.replaceChildren(...parts)
    if (focused) node.querySelector<HTMLElement>(`[data-part="${focused}"]`)?.focus()
  }
  /**
   * Whether the page is current: the revision chip, the line above the preview, the round's progress and the notice
   * inside an open dialog. Cheap enough for every feed event and the one-second clock; text is written only on change.
   */
  const drawLiveness = () => {
    if (state.stopped) return
    const design = state.design
    const round = design && !design.ended ? design.rounds?.at(-1) : undefined
    const count = newerCount()
    const shown = state.revisions.find((revision) => revision.id === state.revision)
    const view = loader.revision({
      shown: state.revision ? { id: state.revision, created: shown?.created } : undefined,
      newer: count,
      following: state.followLatest && !state.choice,
      blocker: blocker(),
      loading: !!liveness.loading && liveness.loading === design?.revision,
      failed: !!liveness.failed && liveness.failed === design?.revision && state.revision !== liveness.failed,
      offline: liveness.feed === "offline" || liveness.unreachable,
      round: round && {
        number: round.number,
        opened: round.opened,
        revision: round.revision,
        published: round.published,
        answered: state.revisions.find((revision) => revision.id === round.published)?.created,
      },
      byAgent: options.feed && liveness.replayed ? liveness.published.has(state.revision) : undefined,
    })
    drawChip(state.failedPreview ? "failed" : view.chip, count)
    drawLine(design?.ended ? "" : view.line, count === 0)
    drawProgress()
    root.querySelectorAll<HTMLElement>("dialog [data-newer]").forEach((notice) => {
      notice.hidden = count === 0
    })
  }
  /** Loads the latest revision again after its live reload failed, keeping the frame on screen until it arrives. */
  const retryLatest = async () => {
    const latest = state.design?.revision
    if (!latest) return
    liveness.failed = ""
    if (state.failedPreview === latest || !state.revision) return chooseRevision(latest)
    await chooseRevision(latest, state.followLatest, !state.followLatest)
  }
  // The chip acts only when it has something to do: show the latest revision, or load it again after a failure.
  element("newer").onclick = () => {
    if (element("newer").dataset.action !== "true") return
    void run(async () => {
      const latest = state.design?.revision
      if (!latest) return
      if (liveness.failed === latest || state.failedPreview === latest) return retryLatest()
      // A note typed in the open card goes into the queue rather than being lost with the card.
      queueCard()
      if (state.card) closeCard()
      await chooseRevision(latest, false, true)
    }, element("newer"))
  }
  // One tab stop per note: the arrow keys, Home and End move between the rows' toggles.
  element("rounds-list").addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(".row-toggle")) return
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const toggles = [...element("rounds-list").querySelectorAll<HTMLElement>(".row-toggle")].filter(
      (toggle) => toggle.offsetParent !== null,
    )
    const index = toggles.indexOf(event.target)
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? toggles.length - 1
          : Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), toggles.length - 1)
    event.preventDefault()
    toggles[next]?.focus()
  })
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
    const viewport = frame.closest<HTMLElement>(".viewport")!
    if (card.parentElement !== viewport) viewport.append(card)
    card.hidden = false
    const place = geometry.anchor(
      state.card.rect,
      stageOf(frame, viewport),
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: viewport.scrollWidth, height: viewport.scrollHeight },
    )
    card.style.left = `${place.left}px`
    card.style.top = `${place.top}px`
  }
  /**
   * Where a preview frame's coordinates land in its pane, measured rather than assumed so any CSS
   * transform on the way (a phone frame scaled to fit, later a slide) is accounted for.
   */
  const stageOf = (frame: HTMLIFrameElement, viewport: HTMLElement) => {
    const outer = viewport.getBoundingClientRect()
    const inner = frame.getBoundingClientRect()
    return {
      scale: frame.offsetWidth ? inner.width / frame.offsetWidth : 1,
      x: inner.left - outer.left - viewport.clientLeft + viewport.scrollLeft,
      y: inner.top - outer.top - viewport.clientTop + viewport.scrollTop,
    }
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
  /**
   * Releases a message the server refused so it no longer holds newer revisions back. Discarding drops its
   * notes and text; keeping them leaves the draft in the composer for a resend.
   */
  const discardPending = (keep: boolean) => {
    const pending = state.pending
    if (!pending) return
    state.pending = undefined
    state.feedbackError = ""
    if (!keep && !pending.review) {
      state.notes = []
      state.assets = []
      state.boards = []
      state.snapshot = ""
      input("note").value = ""
    }
    save()
    drawNotes()
    controls()
    drawLiveness()
    if (!keep) status(copy.discarded, "discarded")
  }
  const queueCard = () => {
    const card = state.card
    if (!card || state.pending || !card.text.trim()) return false
    // Where the note was taken, so the verify judges it at that width and on that phone.
    const width = Math.min(10000, Math.round(element(card.frame).clientWidth))
    const platform = phone()?.platform
    state.notes.push({
      ...(width > 0 ? { width } : {}),
      ...(platform ? { platform } : {}),
      target: card.target,
      params: paramContext(),
      revision: state.revision,
      text: card.text.trim(),
      tag: card.tag,
      elementText: card.elementText,
      label: card.label,
      ...(card.xpath ? { xpath: card.xpath } : {}),
      ...(card.context ? { context: card.context } : {}),
      ...(card.parent ? { parent: card.parent } : {}),
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
      xpath: text("xpath"),
      context: text("context"),
      parent: text("parent"),
      rect,
      text: text("text"),
    }
  }
  /** The parts of a draft that belong to the next message rather than to the revision on screen. */
  const outgoing = () => ({
    notes: [...state.notes],
    text: input("note").value,
    pending: state.pending,
    feedbackError: state.feedbackError,
    assets: [...state.assets],
    snapshot: state.snapshot,
    boards: [...state.boards],
  })
  const sameNote = (a: { target: string; text: string }, b: { target: string; text: string }) =>
    a.target === b.target && a.text === b.text
  /** Takes a draft carried from another revision into the one just restored, without doubling anything. */
  const adopt = (carried: ReturnType<typeof outgoing>) => {
    state.notes = [...state.notes, ...carried.notes.filter((note) => !state.notes.some((item) => sameNote(item, note)))]
    const typed = input("note").value
    input("note").value =
      typed && carried.text && typed !== carried.text ? `${carried.text}\n${typed}` : carried.text || typed
    if (carried.pending) {
      state.pending = carried.pending
      state.feedbackError = carried.feedbackError
    }
    state.assets = [...new Set([...state.assets, ...carried.assets])]
    state.snapshot = carried.snapshot || state.snapshot
    state.boards = [...state.boards, ...carried.boards]
    save()
    drawNotes()
  }
  const draftFields = ["notes", "text", "card", "pending", "feedbackError", "assets", "snapshot", "boards"]
  /** Removes the message parts from a revision's stored draft once they moved to another revision. */
  const release = (name: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem(name) ?? "null")
      if (!stored || typeof stored !== "object") return
      for (const field of draftFields) delete stored[field]
      localStorage.setItem(name, JSON.stringify(stored))
    } catch {
      // Without storage nothing was left behind to move.
    }
  }
  /**
   * Takes what was just sent off every other stored draft of the design: copies left by earlier live reloads would
   * otherwise come back as unsent notes when the reader opens that revision, and be sent twice.
   */
  const sweep = (sent: Design.Feedback) => {
    const prefix = `redcode:design:${endpoint}:${state.design?.id}:`
    try {
      for (const name of Object.keys(localStorage)) {
        if (!name.startsWith(prefix) || name === key()) continue
        const stored = JSON.parse(localStorage.getItem(name) ?? "null")
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue
        const notes = Array.isArray(stored.notes)
          ? stored.notes.filter(
              (note: unknown) =>
                !(
                  note &&
                  typeof note === "object" &&
                  sent.items.some((item) => sameNote(item, note as { target: string; text: string }))
                ),
            )
          : stored.notes
        const pending = stored.pending?.id === sent.id
        const text = !!sent.text && typeof stored.text === "string" && stored.text.trim() === sent.text
        const dropped = Array.isArray(notes) && notes.length !== stored.notes.length
        if (!dropped && !pending && !text) continue
        localStorage.setItem(
          name,
          JSON.stringify({
            ...stored,
            notes,
            ...(pending ? { pending: undefined, feedbackError: "" } : {}),
            ...(text ? { text: "" } : {}),
          }),
        )
      }
    } catch {
      // Without storage there are no other drafts to clear.
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
    state.feedbackError = ""
    state.approvalScreenshot = undefined
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
        state.approvalScreenshot = stored.approvalScreenshot
        state.pending = stored.pending
        state.feedbackError = typeof stored.feedbackError === "string" ? stored.feedbackError : ""
        state.boards = stored.boards ?? []
        state.board = stored.board
        state.variantPending = stored.variantPending
        // A provisional change survives a reload only while its revision is still the latest one.
        const current =
          stored.pendingOperation?.feedback?.revision === state.revision && state.revision === state.design?.revision
        state.pendingOperation = current ? stored.pendingOperation : undefined
        // A stored operation a newer revision has replaced has settled; nothing is left to retry.
        state.operationDraft = stored.pendingOperation && !current ? undefined : stored.operationDraft
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
  const stageCopy = {
    revision: "loadingRevision",
    queued: "loadingQueued",
    tools: "loadingTools",
    build: "loadingBuild",
    assets: "loadingAssets",
    runtime: "loadingRuntime",
  } as const
  /**
   * The preview area: the zero state with the agent's live activity, a loading stage over a skeleton of
   * the target with its elapsed time, a failure with Retry, or the frame once its runtime is ready.
   */
  const drawLoading = () => {
    const view = loading.view
    element("canvas").dataset.phase = view.phase
    element("preview-state").dataset.target = state.design?.target ?? "web"
    const key =
      view.phase === "empty" ? "zeroRevision" : view.phase === "error" ? "previewFailed" : stageCopy[view.stage]
    // Live regions announce every write, so text is only written when it changes.
    const put = (id: string, value: string) => {
      if (element(id).textContent !== value) element(id).textContent = value
    }
    put("preview-stage", copy[key])
    element("preview-agent").hidden = view.phase !== "empty" || !options.feed
    put("preview-agent", view.agent === "idle" ? copy.agentWaiting : activityText(view, Date.now()))
    put(
      "preview-elapsed",
      view.phase === "loading"
        ? copy.loadingElapsed.replace("{{seconds}}", String(loader.elapsed(view, Date.now())))
        : "",
    )
    element("preview-retry").hidden = view.phase !== "error"
    // The failure's summary belongs to the error state; a new load starts without it.
    if (view.phase !== "error") element("preview-error").hidden = true
    element("no-variants").hidden = state.variants.length > 0 || view.phase !== "ready"
  }
  const loadingEvent = (event: LoadingEvent) => {
    const phase = loading.view.phase
    loading.view = loader.reduce(loading.view, event)
    if (loading.view.phase !== "loading") {
      clearTimeout(loading.reveal)
      loading.reveal = undefined
    }
    drawLoading()
    // "Ready for review" needs the revision on screen loaded, so a finished load can change the round's stage.
    if (loading.view.phase !== phase) drawLiveness()
  }
  /** Shows the frame after a while even when its runtime never says it is ready. */
  const revealAfter = (ms: number) => {
    clearTimeout(loading.reveal)
    loading.reveal = setTimeout(() => loadingEvent({ type: "ready" }), ms)
  }
  /**
   * Follows the host's build of a preview while its request is in flight, until the returned stop is
   * called. A cached preview answers at once, so the first question waits a moment.
   */
  const watchBuild = (designID: string, revisionID: string) => {
    const watch = { active: true, timer: undefined as ReturnType<typeof setTimeout> | undefined }
    const tick = async () => {
      const response = await request(`${endpoint}/${designID}/revision/${encodeURIComponent(revisionID)}/status`).catch(
        () => undefined,
      )
      if (!watch.active || state.stopped) return
      // A host without build status still shows that a build is running.
      if (!response?.ok) return loadingEvent({ type: "build", revision: revisionID, stage: "building" })
      const body = await response.json().catch(() => undefined)
      if (!watch.active || state.stopped) return
      if (typeof body?.stage === "string") loadingEvent({ type: "build", revision: revisionID, stage: body.stage })
      watch.timer = setTimeout(() => void tick(), 700)
    }
    watch.timer = setTimeout(() => void tick(), 250)
    return () => {
      watch.active = false
      clearTimeout(watch.timer)
    }
  }
  const entryKey = (event: Design.FeedEvent) =>
    event.type === "published"
      ? `published:${event.revision}`
      : event.type === "verified"
        ? `verified:${event.job}`
        : "id" in event
          ? `${event.type}:${event.id}`
          : ""
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
      const cancelled = document.createElement("small")
      cancelled.className = "muted"
      cancelled.dataset.copy = "feedCancelled"
      cancelled.dataset.copyPrefix = " · "
      cancelled.textContent = ` · ${copy.feedCancelled}`
      if (event.cancelled) row.dataset.cancelled = "true"
      row.append(who, event.text, ...(event.notes ? [notes] : []), ...(event.cancelled ? [cancelled] : []))
    }
    if (event.type === "reply") row.append(...markdown(event.text))
    if (event.type === "tool") {
      row.dataset.status = event.status
      row.textContent = `${event.tool} · ${event.status}${event.summary ? ` · ${event.summary}` : ""}`
    }
    if (event.type === "published") {
      row.dataset.copy = "published"
      // The tool result names the revision's number; a listed revision is numbered by the page.
      const number = event.ordinal ?? ordinal(event.revision)
      row.dataset.copySuffix = `${number ? ` ${fill(copy.chipRevision, { ordinal: number })}` : ""}: ${event.name}`
      row.textContent = `${copy.published}${row.dataset.copySuffix}`
    }
    if (event.type === "verified") {
      const head = document.createElement("strong")
      head.dataset.copy = "verified"
      head.dataset.copySuffix = ` ${event.round} ${copy.verifiedOn} ${revisionName(event.revision)}`
      head.textContent = `${copy.verified}${head.dataset.copySuffix}`
      const glyphs = { pass: "✓", warn: "◐", fail: "✗" } as const
      const lines = event.notes.map((note) => {
        const line = document.createElement("div")
        line.className = "verdict"
        line.dataset.verdict = note.verdict
        const glyph = document.createElement("span")
        glyph.className = "glyph"
        glyph.textContent = glyphs[note.verdict]
        glyph.setAttribute(
          "aria-label",
          copy[note.verdict === "pass" ? "verifyPass" : note.verdict === "warn" ? "verifyWarn" : "verifyFail"],
        )
        const text = document.createElement("span")
        const label = document.createElement("span")
        label.textContent = `${note.index}. ${note.label}`
        const reason = document.createElement("small")
        reason.className = "muted"
        reason.textContent = ` — ${note.reason}`
        text.append(label, reason)
        line.append(glyph, text)
        return line
      })
      const link = document.createElement("a")
      link.href = `${endpoint}/${encodeURIComponent(event.design)}/job/${encodeURIComponent(event.job)}/file`
      link.target = "_blank"
      link.rel = "noopener"
      link.dataset.copy = "openReport"
      link.textContent = copy.openReport
      row.append(head, ...lines, link)
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
      // A reconnect replays history: an entry that did not change keeps its row, so a reader's text
      // selection and scroll position survive the replay.
      const next = entry(event)
      next.hidden = existing.hidden
      if (!existing.isEqualNode(next)) existing.replaceWith(next)
      drawConversation()
      return
    }
    const bottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
    list.append(entry(event))
    if (state.feed.length > 200) {
      state.feed.shift()
      list.querySelector(".entry")?.remove()
    }
    if (bottom) list.scrollTop = list.scrollHeight
    drawConversation()
  }
  const polling = { pending: false, requested: false }
  const poll = () => {
    if (state.stopped || polling.pending) return
    polling.requested = true
    if (
      polling.pending ||
      state.loading ||
      state.working ||
      state.creating ||
      document.hidden ||
      root.querySelector("dialog[open]")
    )
      return
    // Feed events can arrive in one burst before the queued refresh begins.
    polling.pending = true
    polling.requested = false
    void run(
      async () => {
        // A poll that cannot reach the server at all (not one the server refused) means the page is offline.
        await refresh().then(
          () => {
            liveness.unreachable = false
          },
          (error) => {
            liveness.unreachable = (error as { status?: number }).status === undefined
            drawLiveness()
            throw error
          },
        )
      },
      undefined,
      true,
    ).finally(() => {
      polling.pending = false
      if (polling.requested) poll()
    })
  }
  /**
   * The agent went idle after taking the operation up. It counts only once the agent is still idle a
   * moment later: a host may end one turn before starting the next that picks the message up.
   */
  const agentIdle = () => {
    state.idleCheck = undefined
    if (state.stopped || state.agent !== "idle") return
    const operation = state.pendingOperation
    const check = state.operationCheck
    if (operation?.consumed && operation.working) {
      operation.idle = true
      if (!operation.published) failOperation(copy.operationStopped)
      return
    }
    if (!check?.consumed || !check.working) return
    check.idle = true
    if (check.unchanged) failOperation(copy.operationUnchanged)
  }
  /** Keeps what the feed says about now, before the event updates the agent's state and the conversation. */
  const track = (event: Design.FeedEvent) => {
    const now = Date.now()
    if (event.seq > 0) liveness.last = now
    if (event.type !== "state" && event.type !== "agent") liveness.replayed = true
    if (event.type === "state" && event.state === "idle") {
      if (state.agent !== "idle") {
        liveness.idleSince = now
        liveness.idleLive = event.seq > 0
      }
      liveness.tool = undefined
    }
    if (event.type === "tool" && event.seq > 0) {
      if (event.status === "running")
        liveness.tool = { id: event.id, name: event.tool, summary: event.summary, since: now }
      else if (liveness.tool?.id === event.id) liveness.tool = undefined
    }
    if (event.type === "user" && event.pending) liveness.inbox.add(event.id)
    if (event.type === "user" && !event.pending) liveness.inbox.delete(event.id)
    if (event.type !== "published") return
    liveness.published.add(event.revision)
    // Replayed publishes are history; only a live one announces a revision the page has not listed yet.
    if (
      event.seq > 0 &&
      event.design === state.design?.id &&
      event.revision !== state.revision &&
      !state.revisions.some((revision) => revision.id === event.revision)
    )
      liveness.announced = event.revision
  }
  const onFeed = (event: Design.FeedEvent) => {
    if (state.stopped) return
    const announced = liveness.announced
    track(event)
    follow(event)
    // Approval waits for the announced revision even while a dialog holds the poll back.
    if (liveness.announced !== announced) controls()
    drawLiveness()
  }
  const follow = (event: Design.FeedEvent) => {
    if (event.type === "state")
      loadingEvent({ type: "agent", state: event.state, outcome: event.outcome, message: event.message })
    // Waits only describe the live activity line; they are not conversation entries.
    if (event.type === "wait") {
      loadingEvent({
        type: "wait",
        wait: event.wait,
        active: event.active,
        until: event.until,
        message: event.message,
      })
      return
    }
    // A reconnect replays old tool calls; only those made while the agent works are its live activity.
    if (event.type === "tool" && state.agent === "working")
      loadingEvent({ type: "tool", tool: event.tool, status: event.status })
    const operation = state.pendingOperation
    const check = state.operationCheck
    // Agent states say nothing about an operation until a turn has taken its message up: an operation
    // sent while an earlier turn runs waits for that turn, or the next one, to deliver it.
    if (event.type === "state") {
      state.agent = event.state
      if (event.state === "working") {
        clearTimeout(state.idleCheck)
        state.idleCheck = undefined
        if (operation?.consumed) operation.working = true
        if (check?.consumed) check.working = true
        return
      }
      if (!state.idleCheck && ((operation?.consumed && operation.working) || (check?.consumed && check.working)))
        state.idleCheck = setTimeout(agentIdle, 2000)
      return
    }
    if (event.type === "agent") {
      state.mode = event.agent
      if (state.mode !== "design" && state.design) void run(refresh, undefined, true)
      return
    }
    upsert(event)
    if (event.type === "user" && !event.pending && !event.cancelled) {
      // Delivered into a turn: from here on the agent's working and idle states are about this operation.
      const running = state.agent === "working"
      if (operation?.feedback.id === event.id) {
        operation.consumed = true
        operation.working ||= running
      }
      if (check?.feedback === event.id) {
        check.consumed = true
        check.working ||= running
      }
    }
    if (event.type !== "published") return
    if (operation && event.design === state.design?.id && event.revision !== operation.feedback.revision)
      operation.published = event.revision
    if (
      event.design === state.design?.id &&
      (event.revision !== state.revision || !state.revisions.some((revision) => revision.id === event.revision))
    )
      poll()
  }
  /**
   * Shows a revision. `keep` is a live reload of the latest revision over the one on screen: the frame, variants,
   * screens and scroll stay until it arrives, and a failure leaves the last good frame up and says so. Both a live
   * reload and `carry` (the reader asked for the latest revision) move the drafts along: the queued notes, the
   * message and an unsent send leave the revision they were on, so it can never offer them again.
   */
  const chooseRevision = async (revisionID: string, keep = false, carry = false) => {
    const revision =
      state.revisions.find((item) => item.id === revisionID) ??
      (await api<Design.Revision[]>(`/${state.design!.id}/revision`)).find((item) => item.id === revisionID)
    if (!revision) return
    clearTimeout(loading.reveal)
    loadingEvent({ type: "load", revision: revisionID, at: Date.now(), quiet: keep })
    liveness.loading = revisionID
    drawLiveness()
    const stop = watchBuild(state.design!.id, revisionID)
    const response = await request(`${endpoint}/${state.design!.id}/revision/${revisionID}/preview`, {
      signal: controller.signal,
    }).finally(() => {
      stop()
      liveness.loading = ""
    })
    if (!response.ok) {
      const body = await response.json().catch(() => undefined)
      const message = typeof body?.message === "string" ? body.message : `${copy.failure} (${response.status})`
      if (keep && state.revision && state.revision !== revisionID) {
        liveness.failed = revisionID
        liveness.failure = message
        drawLiveness()
        return
      }
      state.failedPreview = revisionID
      loadingEvent({ type: "failed", revision: revisionID, message })
      element("preview-error").textContent = `${revision.name}: ${message}`
      element("preview-error").hidden = false
      element("primary-pane").hidden = true
      element("peer-pane").hidden = true
      controls()
      throw new Error(message)
    }
    const html = await response.text()
    state.failedPreview = ""
    if (liveness.failed === revisionID) liveness.failed = ""
    element("preview-error").hidden = true
    element("primary-pane").hidden = false
    // A newer latest revision replaces the provisional view; its variants decide whether it carried the change.
    const operation = state.pendingOperation
    if (operation && revisionID !== operation.feedback.revision && revisionID === state.design?.revision) {
      state.pendingOperation = undefined
      state.operationCheck = {
        action: operation.feedback.action,
        feedback: operation.feedback.id,
        revision: operation.feedback.revision,
        variants: operation.variants,
        consumed: !!operation.consumed,
        working: !!operation.working,
        idle: !!operation.idle,
        unchanged: false,
      }
    }
    const from = state.revision && state.revision !== revisionID ? key() : ""
    const carried = carry && !keep && from ? outgoing() : undefined
    if (state.revision) save()
    if (state.revision !== revisionID && !keep) {
      state.variant = ""
      state.peer = ""
    }
    state.revision = revisionID
    state.followLatest = revisionID === state.design?.revision
    if (liveness.switched?.revision !== revisionID) liveness.switched = undefined
    // A live reload keeps the draft, the selected variants and the reader's scroll position.
    if (keep) save()
    if (!keep) restoreDraft()
    if (carried) adopt(carried)
    if (from && (keep || carried)) release(from)
    state.html = html
    if (!keep) state.variants = []
    // A live reload reopens the screens the reader was on; another revision starts on each first screen.
    state.restoreScreens = keep ? { ...state.screenCurrent } : undefined
    if (!keep) {
      state.screens = []
      state.screenCurrent = {}
      drawScreens()
    }
    state.restoreScroll = keep
    loadingEvent({ type: "document", revision: revisionID })
    revealAfter(10000)
    element<HTMLIFrameElement>("peer-preview").removeAttribute("srcdoc")
    element<HTMLIFrameElement>("preview").srcdoc = html
    if (keep && state.comparing) element<HTMLIFrameElement>("peer-preview").srcdoc = html
    input("revisions").value = revisionID
    // Restoring only means something for a revision that is no longer the latest one.
    element("restore").hidden = state.design?.revision === revisionID
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
    drawLiveness()
  }
  const picker = (id: string, items: { id: string; name: string }[]) => {
    const select = element<HTMLSelectElement>(id)
    if (
      select.options.length === items.length &&
      items.every(
        (item, index) => select.options[index].value === item.id && select.options[index].textContent === item.name,
      )
    )
      return
    select.replaceChildren(...items.map((item) => new Option(item.name, item.id)))
  }
  const taskView = { signature: "", done: 0, total: 0 }
  const drawTaskCount = () =>
    write(
      element("tasks-count"),
      taskView.total
        ? copy.tasksDone.replace("{{done}}", String(taskView.done)).replace("{{total}}", String(taskView.total))
        : "",
    )
  const jobRows = new Map<string, { signature: string; row: HTMLElement }>()
  const refresh = async (designID = state.design?.id) => {
    const documents = await api<Design.Info[]>()
    picker("designs", documents)
    const current = documents.find((item) => item.id === designID) ?? documents.at(-1)
    // Without a design yet the brief is the page; one the agent creates replaces it on a later refresh.
    if (!current) {
      if (!state.creating) showStudio(false)
      return
    }
    const changed = state.design?.id !== current.id
    const onLatest = !changed && state.followLatest
    const revisionChanged = changed || current.revision !== state.design?.revision
    if (changed) {
      // A pick from the design that was on screen means nothing for the one replacing it.
      state.choice = ""
      liveness.announced = ""
      liveness.failed = ""
      liveness.switched = undefined
      state.followLatest = true
      state.failedPreview = ""
      element("preview-error").hidden = true
      element("primary-pane").hidden = false
      save()
      state.revision = ""
      state.html = ""
      state.variants = []
      state.variant = ""
      state.peer = ""
      state.screens = []
      state.screenCurrent = {}
      state.restoreScreens = undefined
      element<HTMLIFrameElement>("preview").removeAttribute("srcdoc")
      element<HTMLIFrameElement>("peer-preview").removeAttribute("srcdoc")
      drawVariants()
    }
    state.design = current
    if (changed) {
      disclose(element<HTMLDetailsElement>("design-tasks-section"), "tasks", false)
      // Without a terminal beside the page (a shared link, a session started in the browser) Activity is the transcript.
      disclose(element<HTMLDetailsElement>("activity"), "activity", !local)
    }
    if (current.ended && current.approvedRevision && state.mode && state.mode !== "design") {
      closeReview()
      return
    }
    loadingEvent({ type: "design", revision: current.revision ?? undefined, at: Date.now() })
    drawWidths()
    // Lock stale revision actions before the remaining refresh requests can yield.
    controls()
    drawRounds()
    drawNotes()
    const todos = await api<SessionTodo.Info[]>("/todo").catch(() => undefined)
    const signature = todos === undefined ? "unavailable" : JSON.stringify(todos)
    if (signature !== taskView.signature || changed) {
      taskView.signature = signature
      taskView.done = (todos ?? []).filter((todo) => todo.status === "completed").length
      taskView.total = (todos ?? []).filter((todo) => todo.status !== "cancelled").length
      drawTaskCount()
      element("design-tasks").replaceChildren()
      if (!todos || !todos.length) element("design-tasks").textContent = todos ? copy.tasksEmpty : copy.tasksUnavailable
      for (const todo of todos ?? []) {
        const row = document.createElement("div")
        row.className = "note"
        row.dataset.task = todo.id
        row.dataset.status = todo.status
        const label = document.createElement("span")
        label.textContent = todo.title || todo.content
        const status = document.createElement("small")
        status.textContent = [todo.status.replaceAll("_", " "), todo.reason].filter(Boolean).join(" · ")
        row.append(label, status)
        element("design-tasks").append(row)
      }
    }
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
    // Retry a failed list fetch even after the document projection advanced to the new revision.
    if (
      revisionChanged ||
      !state.revisions.length ||
      (current.revision && !state.revisions.some((revision) => revision.id === current.revision))
    )
      state.revisions = await api<Design.Revision[]>(`/${current.id}/revision`)
    const revisions = state.revisions
    picker(
      "revisions",
      revisions.map((revision, index) => ({
        id: revision.id,
        name: `${fill(copy.chipRevision, { ordinal: revisions.length - index })} · ${revision.name} · ${revision.id.slice(-8)}`,
      })),
    )
    if (state.revisions.some((revision) => revision.id === liveness.announced)) liveness.announced = ""
    const initial = changed || !state.revision
    const newer = !initial && !state.choice && onLatest && current.revision !== state.revision
    // An empty note card holds nothing worth keeping, so it does not hold a newer revision back.
    if (newer && state.card && !state.card.text.trim()) closeCard()
    // A new revision replaces the one on screen only while the reader is on the latest one and nothing holds it
    // back (see blocker); while browsing history the revision chip offers it instead.
    const live = newer && !blocker()
    if (
      current.revision &&
      (initial || live) &&
      state.failedPreview !== current.revision &&
      liveness.failed !== current.revision
    ) {
      const target = revisions.find((revision) => revision.id === current.revision)
      await chooseRevision(current.revision, live)
      // A switch that waited (a hidden tab, a note or a send in the way) says how old the revision it shows is.
      if (live && target && state.revision === target.id && Date.now() - target.created > 60000) {
        liveness.switched = { revision: target.id, created: target.created }
        clearTimeout(liveness.switchedTimer)
        liveness.switchedTimer = setTimeout(() => {
          liveness.switched = undefined
          drawLiveness()
        }, 30000)
      }
    }
    // Rebuilding the options must not undo a pick that is still waiting for this refresh to finish.
    input("revisions").value = state.choice || state.failedPreview || state.revision
    element("restore").hidden = current.revision === state.revision
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
    state.jobs = jobs
    state.audits = jobs.filter((job) => job.input.revision === state.revision && job.audit)
    let summary = root.querySelector<HTMLElement>("[data-review-evidence]")
    if (!summary) {
      summary = document.createElement("div")
      summary.dataset.reviewEvidence = ""
      element("jobs").before(summary)
    }
    drawEvidence()
    const jobList = element("jobs")
    const rows = jobs.map((job) => {
      const signature = JSON.stringify([current.id, current.name, job])
      const previous = jobRows.get(job.id)
      if (previous?.signature === signature) return previous.row
      const row = document.createElement("div")
      row.className = "note"
      const reviewing = job.input.format === "audit" || job.input.format === "verify"
      const label = reviewing
        ? job.status === "queued" || job.status === "running"
          ? copy.stateReviewing
          : copy.qualityReview
        : job.input.format
      row.textContent = `${label}${reviewing ? ` (${job.input.format})` : ""} · ${job.status} · ${Math.round(job.progress * 100)}%${job.error ? ` · ${job.error}` : ""}`
      if (job.audit) {
        const details = document.createElement("details")
        const summary = document.createElement("summary")
        summary.dataset.copy = "findings"
        summary.dataset.copySuffix = `: ${job.audit.findings.length}`
        summary.textContent = `${copy.findings}: ${job.audit.findings.length}`
        const content = document.createElement("div")
        content.textContent = [...job.audit.scenarios, ...job.audit.findings].join("\n")
        content.style.whiteSpace = "pre-wrap"
        details.open = previous?.row.querySelector("details")?.open ?? false
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
            anchor.download = `${current.name}.${job.input.format === "gif" ? "gif" : job.input.format === "pdf" ? "pdf" : "html"}`
            anchor.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          })
        row.append(button)
      }
      jobRows.set(job.id, { signature, row })
      return row
    })
    const jobIDs = new Set(jobs.map((job) => job.id))
    for (const [id, item] of jobRows) {
      if (jobIDs.has(id)) continue
      item.row.remove()
      jobRows.delete(id)
    }
    rows.forEach((row, index) => {
      if (jobList.children[index] !== row) jobList.insertBefore(row, jobList.children[index] ?? null)
    })
    // Replaced rows stay beside their replacement until the new order is in place.
    while (jobList.children.length > rows.length) jobList.lastElementChild!.remove()
    const message = current.ended ? "closed" : current.revision ? "draft" : "waiting"
    text("review-state", copy[message])
    element("review-state").dataset.copy = message
    element("review-state").hidden = !current.ended && !!current.revision
    controls()
    drawLiveness()
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
  element("design-target").onchange = () => {
    element("design-platform-field").hidden = input("design-target").value !== "app"
  }
  element<HTMLFormElement>("create").onsubmit = (event) => {
    event.preventDefault()
    // The reviewer picks the target here, so no detection runs for a design created from this form.
    const target = input("design-target").value
    const platform = target === "app" ? input("design-platform").value : ""
    void run(async () => {
      const created = await api<Design.Info>("", "POST", {
        name: input("name").value,
        journey: input("journey").value,
        engine: input("engine").value,
        application: input("application").value,
        kind: target === "presentation" ? "deck" : "screen",
        target,
        ...(platform ? { platform } : {}),
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
  const resize = () => {
    for (const id of ["preview", "peer-preview"])
      element(id).style.width = frame() ? "" : input("width").value === "100%" ? "100%" : `${input("width").value}px`
  }
  element("width").onchange = resize
  /** The phone frame an app design is previewed in; none for other targets or without frames. */
  const phone = () =>
    state.design?.target === "app" && options.device
      ? options.device(state.device ?? state.design.platform ?? "ios")
      : undefined
  /**
   * The fixed frame a design is previewed in, scaled to fit its pane: a phone for an app design, a
   * 1920×1080 slide canvas for a presentation, none for the web.
   */
  const frame = () => {
    if (presenting()) return { kind: "slide", width: 1920, height: 1080, bezel: 0, screenRadius: 0, html: "" }
    const spec = phone()
    return spec && { kind: spec.platform, ...spec }
  }
  /**
   * Draws the phone frame or the slide canvas around both preview frames, or takes it away. The frames
   * stay where they are in the DOM (moving an iframe reloads it); only their wrappers change.
   */
  const drawDevice = () => {
    const spec = frame()
    element("device-switch").hidden = !phone()
    element("platform-field").hidden = state.design?.target !== "app"
    // The page cannot clear a saved platform, so "both" is offered only while none is saved.
    const both = element("platform").querySelector<HTMLOptionElement>('option[value=""]')!
    both.disabled = !!state.design?.platform
    if (input("platform").value !== (state.design?.platform ?? ""))
      input("platform").value = state.design?.platform ?? ""
    element("width").hidden = !!spec
    element("present").hidden = !presenting()
    element("pdf").hidden = !presenting()
    for (const id of ["preview", "peer-preview"]) {
      const box = element(`${id}-device`)
      const viewport = box.parentElement!
      const chrome = box.querySelector<HTMLElement>(".device-chrome")!
      if (!spec) {
        delete viewport.dataset.device
        box.removeAttribute("style")
        chrome.replaceChildren()
        continue
      }
      // The design list refreshes every few seconds; an unchanged frame is left as it is.
      if (viewport.dataset.device === spec.kind) continue
      viewport.dataset.device = spec.kind
      box.style.cssText = `width:${spec.width + 2 * spec.bezel}px;height:${spec.height + 2 * spec.bezel}px;--device-bezel:${spec.bezel}px;--device-width:${spec.width}px;--device-height:${spec.height}px;--device-radius:${spec.screenRadius}px`
      chrome.innerHTML = spec.html
    }
    for (const platform of ["ios", "android"])
      element(`device-${platform}`).setAttribute("aria-pressed", String(phone()?.platform === platform))
    resize()
    fitDevice()
    safeArea()
  }
  /** Scales each framed phone or slide to fit its pane, never above its real size. */
  const fitDevice = () => {
    const spec = frame()
    if (!spec) return
    for (const id of ["preview", "peer-preview"]) {
      const box = element(`${id}-device`)
      const viewport = box.parentElement!
      const at = geometry.fit(
        { width: spec.width + 2 * spec.bezel, height: spec.height + 2 * spec.bezel },
        { width: viewport.clientWidth, height: viewport.clientHeight },
        12,
      )
      box.style.transform = `translate(${at.x}px,${at.y}px) scale(${at.scale})`
    }
    placeCard()
  }
  /**
   * CSS env() cannot be set from outside a page, so the framed prototype gets the phone's safe-area
   * insets as --safe-area-top and --safe-area-bottom (the playbook asks designs to read
   * max(env(safe-area-inset-*, 0px), var(--safe-area-*, 0px))). The audit's emulated phones set the same
   * properties.
   */
  const safeArea = () => {
    const spec = phone()
    if (!spec) return
    const insets = { "--safe-area-top": spec.safeArea.top, "--safe-area-bottom": spec.safeArea.bottom }
    for (const id of ["preview", "peer-preview"])
      for (const [key, value] of Object.entries(insets))
        element<HTMLIFrameElement>(id).contentWindow?.postMessage(
          { type: "design:tweak", key, value: `${value}px` },
          "*",
        )
  }
  const fitting = new ResizeObserver(() => fitDevice())
  for (const id of ["preview", "peer-preview"]) fitting.observe(element(`${id}-device`).parentElement!)
  /** Peeks at an app design in the iPhone or the Android frame; the design's platform stays as it is. */
  const choosePlatform = async (platform: "ios" | "android") => {
    if (state.design?.target !== "app") return
    state.device = platform
    drawDevice()
  }
  click("device-ios", () => choosePlatform("ios"))
  click("device-android", () => choosePlatform("android"))
  /** The explicit platform control in Details: saved on the design, so the agent designs and audits for it. */
  element("platform").onchange = () =>
    void run(async () => {
      const design = state.design
      const platform = input("platform").value
      if (design?.target !== "app" || (platform !== "ios" && platform !== "android") || design.platform === platform)
        return
      state.design = await api<Design.Info>(`/${design.id}`, "PATCH", { platform })
      state.device = undefined
      drawWidths()
    }, element("platform"))
  // Opened synchronously, inside the click, so the browser lets the new window through; it starts on
  // the slide on screen, and the presentation's own P key opens the presenter view.
  element("present").onclick = () => {
    const design = state.design
    if (!design || !presenting()) return
    const url = new URL(`${endpoint}/${encodeURIComponent(design.id)}/present`, location.href)
    if (state.revision) url.searchParams.set("revision", state.revision)
    if (state.variant) url.searchParams.set("variant", state.variant)
    url.hash = currentScreen()
    open(url.toString(), `redcode-audience-${design.id}`)
  }
  /** Offers the open design's target viewports, keeping the chosen width when the new list has it. */
  const drawWidths = () => {
    drawDevice()
    const sizes = options.viewports?.(state.design?.target, state.design?.platform, {
      breakpoints: options.breakpoints,
    })
    if (!sizes?.length) return
    const names: Record<string, keyof ReviewCopy> = {
      ios: "iphone",
      android: "android",
      "390": "mobile",
      "768": "tablet",
      "1440": "desktop",
      "1920": "slide",
    }
    const previous = input("width").value
    element("width").innerHTML = [
      `<option value="100%" data-copy="full">${escape(copy.full)}</option>`,
      ...sizes.map((size) => {
        const name = names[size.device ?? String(size.width)]
        return `<option value="${size.width}"${name ? ` data-copy="${name}"` : ""}>${escape(name ? copy[name] : `${size.width} px`)}</option>`
      }),
    ].join("")
    // A phone design reads best at phone width; web and slides start from the full canvas.
    input("width").value = sizes.some((size) => String(size.width) === previous)
      ? previous
      : state.design?.target === "app"
        ? String(sizes[0].width)
        : "100%"
    resize()
  }
  // Restoring publishes a new latest revision: it asks first, and waits while the agent works, whose next
  // publish would replace it.
  click("restore", async () => {
    if (agentState() === "working") throw new Error(copy.restoreBusy)
    write(element("restore-heading"), fill(copy.restoreConfirm, { revision: revisionName(state.revision) }))
    element<HTMLDialogElement>("restore-dialog").showModal()
    element("cancel-restore").focus()
  })
  element("cancel-restore").onclick = () => element<HTMLDialogElement>("restore-dialog").close()
  click("confirm-restore", async () => {
    element<HTMLDialogElement>("restore-dialog").close()
    if (agentState() === "working") throw new Error(copy.restoreBusy)
    const result = await api<Design.Revision>(`/${state.design!.id}/restore`, "POST", { revision: state.revision })
    await refresh()
    await chooseRevision(result.id)
  })
  click("approve", async () => {
    state.captureFailed = false
    state.captureReason = ""
    state.approving = {
      revision: state.revision,
      ...(state.variant ? { variant: state.variants.find((item) => item.id === state.variant) } : {}),
    }
    element("approval-revision").textContent =
      `${state.design?.name} · ${state.revisionInfo?.name}\n${state.approving.variant?.name ?? copy.approvalWhole}`
    // What the agent left unresolved or declined is read here, before the person approves.
    const line = (note: Design.Note) => {
      const item = document.createElement("li")
      item.dataset.feedback = note.feedback
      item.dataset.index = String(note.index)
      item.textContent = `${copy[statusCopy(note.status)]} · ${note.item.label || note.item.target}: ${note.item.text}${note.reason ? ` — ${note.reason}` : ""}`
      return item
    }
    const declined = (state.design?.notes ?? []).filter(
      (note) => (note.status === "accepted" || note.status === "unresolved") && note.by !== "reviewer",
    )
    element("approval-review").hidden = !declined.length
    element("approval-review-list").replaceChildren(...declined.map(line))
    const open = openNotes()
    element("approval-open").hidden = !open.length
    element("approval-open-list").replaceChildren(...open.map(line))
    element("record-approve").hidden = !open.length
    element<HTMLDialogElement>("approve-dialog").showModal()
    element("cancel-approve").focus()
  })
  /** The capture's technical reason follows the notice untranslated: it is for diagnosis, not for reading aloud. */
  const captureNotice = () =>
    state.captureReason ? `${copy.screenshotUnavailable} (${state.captureReason})` : copy.screenshotUnavailable
  const captureApproval = async () => {
    if (!state.approving) return
    if (!input("approval-screenshot").checked) {
      state.approving = { revision: state.approving.revision, variant: state.approving.variant }
      return
    }
    const approval = state.approving
    if (
      state.approvalScreenshot?.revision === approval.revision &&
      state.approvalScreenshot.variant === (approval.variant?.id ?? "")
    ) {
      state.approving = { ...approval, screenshot: state.approvalScreenshot.asset }
      return
    }
    status(copy.capturing, "capturing")
    const frame = element<HTMLIFrameElement>("preview").contentWindow
    const captured = await new Promise<{
      data: string
      revision: string
      variant: string
      screen: string
      width: number
      height: number
      scrollX: number
      scrollY: number
    }>((resolve, reject) => {
      const request = crypto.randomUUID()
      const finish = (error?: Error, view?: Parameters<typeof resolve>[0]) => {
        clearTimeout(timer)
        window.removeEventListener("message", receive)
        controller.signal.removeEventListener("abort", abort)
        if (error) reject(error)
        if (view) resolve(view)
      }
      const abort = () => finish(new Error("the review closed before the preview answered"))
      const receive = (event: MessageEvent) => {
        if (event.source !== frame || event.data?.type !== "design:capture-result" || event.data.request !== request)
          return
        const view = event.data
        if (view.error)
          return finish(
            new Error(typeof view.reason === "string" && view.reason ? view.reason : "the preview could not be drawn"),
          )
        if (view.revision !== approval.revision) return finish(new Error("the preview shows another revision"))
        if (approval.variant && view.variant !== approval.variant.id)
          return finish(new Error("the preview shows another variant"))
        if (
          typeof view.variant !== "string" ||
          typeof view.screen !== "string" ||
          typeof view.data !== "string" ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(view.data) ||
          view.data.length > 14 * 1024 * 1024 ||
          ![view.width, view.height, view.scrollX, view.scrollY].every(Number.isFinite) ||
          view.width <= 0 ||
          view.height <= 0
        )
          return finish(new Error("the preview returned an image the review cannot use"))
        finish(undefined, view)
      }
      // A large prototype on a busy machine needs several seconds; the dialog shows the capture in progress meanwhile.
      const timer = setTimeout(() => finish(new Error("the preview did not answer within 20 seconds")), 20000)
      window.addEventListener("message", receive)
      controller.signal.addEventListener("abort", abort, { once: true })
      frame?.postMessage({ type: "design:capture", request }, "*")
    })
    const asset = await api<Design.Asset>(`/${state.design!.id}/asset`, "POST", {
      name: `screenshot1-${approval.revision}.png`,
      mime: "image/png",
      data: captured.data.slice("data:image/png;base64,".length),
      source: JSON.stringify({
        type: "design-approval-capture",
        reference: "$screenshot1",
        revision: captured.revision,
        variant: captured.variant,
        screen: captured.screen,
        width: captured.width,
        height: captured.height,
        scrollX: captured.scrollX,
        scrollY: captured.scrollY,
      }),
    })
    state.approvalScreenshot = { revision: approval.revision, variant: approval.variant?.id ?? "", asset: asset.id }
    state.approving = { ...approval, screenshot: asset.id }
    save()
  }
  const finishApproval = async () => {
    if (!state.approving) return
    state.captureFailed = false
    state.captureReason = ""
    await captureApproval().catch((error: unknown) => {
      state.captureFailed = true
      state.captureReason = error instanceof Error ? error.message : String(error)
      console.warn("Design approval capture failed:", state.captureReason)
      status(captureNotice(), undefined, "error")
    })
    const approval = await api<{ agent: string }>(`/${state.design!.id}/approve`, "POST", state.approving)
    element<HTMLDialogElement>("approve-dialog").close()
    if (approval.agent === "plan") {
      closeReview()
      return
    }
    await refresh()
    if (state.captureFailed) return status(captureNotice(), undefined, "success")
    status(copy.approved, "approved", "success")
  }
  // The reviewer explicitly accepts open notes before the same approval and Plan handoff.
  click("record-approve", async () => {
    if (!state.approving) return
    const open = openNotes()
    if (open.length)
      await api(`/${state.design!.id}`, "PATCH", {
        by: "reviewer",
        notes: open.map((note) => ({
          feedback: note.feedback,
          index: note.index,
          status: "accepted",
          reason: copy.approvalRecordAll,
        })),
      })
    await finishApproval()
  })
  element("cancel-approve").onclick = () => element<HTMLDialogElement>("approve-dialog").close()
  click("confirm-approve", finishApproval)
  click("reopen", async () => {
    await api(`/${state.design!.id}/reopen`, "POST")
    await refresh()
  })
  click("refresh-system", async () => {
    await api(`/${state.design!.id}/refresh`, "POST")
    await refresh()
  })
  input("note").oninput = save
  click("discard-pending", async () => discardPending(false))
  // The message goes again from the latest revision: the drafts move along with the reload.
  click("reload-resend", async () => {
    discardPending(true)
    await refresh()
    const latest = state.design?.revision
    if (latest && latest !== state.revision) await chooseRevision(latest, false, true)
    await send(false)
  })
  const send = async (end: boolean) => {
    if (!state.revision) return
    // Text typed in an open note card is part of what Send sends.
    queueCard()
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
    element("feedback-status").textContent = copy.sending
    element("feedback-status").dataset.tone = "info"
    try {
      await api(`/${state.design!.id}/feedback`, "POST", state.pending)
    } catch (error) {
      state.feedbackError = error instanceof Error ? error.message : copy.failure
      save()
      drawNotes()
      // The server refuses to end while notes are open; the saved draft is kept, minus the ending, so
      // a retry sends the notes instead of hitting the same refusal.
      if (state.pending.end && (error as { status?: number }).status === 409) {
        state.pending = { ...state.pending, end: false }
        save()
        drawNotes()
        throw Object.assign(new Error(`${error instanceof Error ? error.message : copy.failure} ${copy.endRefused}`), {
          status: 409,
        })
      }
      // A refused review (too long, an oversized attachment) was never stored: release it so the notes can
      // be edited and sent again, instead of retrying the same payload into the same refusal.
      if ((error as { status?: number }).status === 400) {
        state.pending = undefined
        state.feedbackError = ""
        save()
        drawNotes()
        controls()
      }
      throw error
    }
    const sent = state.pending
    if (options.feed)
      upsert({
        type: "user",
        id: sent.id,
        seq: 0,
        at: Date.now(),
        text: sent.text || (sent.review ? `${copy.runAntiSlop}: ${sent.review.name}` : ""),
        notes: sent.items.length,
      })
    state.pending = undefined
    state.feedbackError = ""
    sweep(sent)
    if (!sent.review) {
      state.notes = []
      state.assets = []
      state.boards = []
      state.snapshot = ""
      input("note").value = ""
    }
    save()
    drawNotes()
    element("feedback-status").hidden = false
    element("feedback-status").textContent = sent.review ? copy.antiSlopRequested : copy.received
    element("feedback-status").dataset.tone = "success"
    status(sent.review ? copy.antiSlopRequested : copy.received, sent.review ? "antiSlopRequested" : "received")
    // The notes just sent opened or extended a round: reload the document so the page shows it at once.
    if (sent.items.length) await refresh()
  }
  element("cancel-anti-slop").onclick = () => element<HTMLDialogElement>("anti-slop-dialog").close()
  click("confirm-anti-slop", async () => {
    const variant = state.variants.find((variant) => variant.id === state.variant)
    if (!variant || (state.pending && !state.pending.review)) return
    state.pending ??= {
      id: `msg_${crypto.randomUUID()}` as Design.Feedback["id"],
      revision: state.revision,
      review: variant,
      params: paramContext(),
      text: input("anti-slop-text").value.trim(),
      items: [],
      assets: [],
      snapshot: "",
      delivery: "steer",
      end: false,
    }
    save()
    await send(false)
    element<HTMLDialogElement>("anti-slop-dialog").close()
    input("anti-slop-text").value = ""
  })
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
  /** An operation carried out by a revision: nothing is left to retry, and notes follow a merge's kept variant. */
  const settleOperation = (action: Design.VariantOperation) => {
    state.operationCheck = undefined
    state.lastFailure = undefined
    state.operationDraft = undefined
    state.retarget =
      action.kind === "merge" ? Object.fromEntries(action.variants.slice(1).map((id) => [id, action.variants[0]])) : {}
    element("operation-state").hidden = true
    save()
  }
  /** Reverts a provisional change still on screen and reports why, keeping the request for a retry. */
  const failOperation = (message: string) => {
    const operation = state.pendingOperation
    const check = state.operationCheck
    const action = operation?.feedback.action ?? check?.action
    state.pendingOperation = undefined
    state.operationCheck = undefined
    if (action) state.operationDraft = action
    const failed = operation
      ? { revision: operation.feedback.revision, variants: operation.variants }
      : check && { revision: check.revision, variants: check.variants }
    state.lastFailure = action && failed ? { action, ...failed } : undefined
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
    }
    state.operationDraft = action
    state.operationCheck = undefined
    state.lastFailure = undefined
    state.retarget = {}
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
    if (kind === "delete" && state.variants.length < 2) return
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
    syncRename()
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
  /** A rename must name something other than the label the variant already has. */
  function renameProblem() {
    const current = state.composing
    if (current?.kind !== "rename") return undefined
    const name = input("operation-name").value.trim()
    return !name || name === variantLabels(current.variants)[0].trim() ? copy.renameSame : undefined
  }
  const syncRename = () => {
    if (state.composing?.kind !== "rename") return
    const problem = renameProblem()
    element("operation-hint").hidden = !problem
    element("operation-hint").dataset.copy = "renameSame"
    element("operation-hint").textContent = copy.renameSame
    element<HTMLButtonElement>("confirm-operation").disabled = operationBlocked() || !!problem
  }
  // Typed guidance and names stay with the request until it is sent, including across a reload.
  for (const id of ["operation-name", "operation-text"])
    input(id).addEventListener("input", () => {
      syncRename()
      const action = composed()
      if (!action || renameProblem()) return
      state.operationDraft = action
      save()
    })
  element("operation-form").addEventListener("submit", (event) => {
    event.preventDefault()
    const action = composed()
    if (!action || renameProblem()) return
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
  // Escape leaves the merge selection; it is not a request to stop annotating.
  element("merge-bar").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    element("cancel-merge").click()
  })
  element("cancel-merge").addEventListener("click", () => {
    state.merging = false
    state.mergePick = []
    drawVariants()
    element<HTMLButtonElement>("variant-actions").focus()
  })
  element("retry-operation").addEventListener("click", () => {
    const draft = state.operationDraft
    if (!draft) return
    if (draft.kind !== "reorder") return openOperation(draft.kind, [...draft.variants])
    // The variants may have changed since: keep the requested order for the ids still present.
    const ids = state.variants.map((item) => item.id)
    const requested = (draft.order ?? []).filter((id) => ids.includes(id))
    const order = [...requested, ...ids.filter((id) => !requested.includes(id))]
    if (ids.length < 2 || order.join("\n") === ids.join("\n")) return
    void run(() => startOperation({ kind: "reorder", variants: ids, labels: variantLabels(ids), order }))
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
  click("share", async () => {
    const shared = await api<{ url?: string }>("/share")
    const dialog = document.createElement("dialog")
    dialog.className = "action-dialog"
    const text = document.createElement("p")
    text.textContent = shared.url ? copy.shareLink : copy.shareUnavailable
    const link = document.createElement("input")
    link.readOnly = true
    link.value = shared.url ?? ""
    link.hidden = !shared.url
    link.setAttribute("aria-label", copy.share)
    link.onclick = () => link.select()
    const close = document.createElement("button")
    close.textContent = copy.shareClose
    close.onclick = () => dialog.close()
    dialog.append(text, link, close)
    dialog.onclose = () => dialog.remove()
    root.append(dialog)
    dialog.showModal()
    if (shared.url) {
      link.focus()
      link.select()
    }
  })
  click("apply", () => publishTweaks({ ...state.design!.tweaks, [input("token").value]: input("value").value }))
  click("reset", () => publishTweaks({}))
  for (const format of ["html", "pdf", "audit", "gif", "compare"] as const)
    click(format, async () => {
      if (!state.revision) return
      await api(`/${state.design!.id}/job`, "POST", {
        revision: format === "compare" ? state.design!.approvedRevision : state.revision,
        format,
        // An audit inspects, and a PDF prints, the variant on screen.
        ...((format === "audit" || format === "pdf") && state.variant ? { variant: state.variant } : {}),
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
  element("preview").addEventListener("load", () => {
    // Emptying the frame loads about:blank, which is not a revision.
    if (!element<HTMLIFrameElement>("preview").srcdoc) return
    loadingEvent({ type: "frame" })
    if (loading.view.phase === "loading") revealAfter(3000)
  })
  element("preview-retry").onclick = () => element("refresh").click()
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
    // Escape leaves the merge selection wherever it is pressed, the preview frame included.
    if (state.merging && key === "Escape" && !root.querySelector("dialog[open]")) {
      element("cancel-merge").click()
      return true
    }
    if (
      root.querySelector("dialog[open]") ||
      !element("menu").hidden ||
      !element("variant-menu").hidden ||
      state.merging ||
      state.card
    )
      return false
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
    const path = event.composedPath()
    const target = path[0]
    const idle = target === document.body || target === document.documentElement
    if (!path.includes(host) && (scoped || !idle)) return
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return
    // A deck moves between slides from the review too, unless a dialog, menu or note card has the keys.
    if (
      !(event.key === " " && target instanceof HTMLElement && target.matches("button, summary, a[href]")) &&
      !element("studio").hidden &&
      !root.querySelector("dialog[open]") &&
      element("menu").hidden &&
      element("variant-menu").hidden &&
      !state.card &&
      stepSlide(event.key, event.shiftKey)
    ) {
      event.preventDefault()
      return
    }
    if (event.key.toLowerCase() !== "a" && event.key !== "Escape") return
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
    if (event.data?.type === "design:ready") {
      if (event.source === element<HTMLIFrameElement>("preview").contentWindow) loadingEvent({ type: "ready" })
      return
    }
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
    if (event.data?.type === "design:screens") {
      const preview = element<HTMLIFrameElement>("preview").contentWindow
      if (event.source !== preview || !Array.isArray(event.data.screens)) return
      const id = /^[a-zA-Z0-9_-]{1,64}$/
      state.screens = event.data.screens
        .slice(0, 200)
        .filter(
          (item: unknown): item is { id: string; name: string; variant: string } =>
            !!item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string" &&
            id.test(item.id) &&
            "name" in item &&
            typeof item.name === "string" &&
            "variant" in item &&
            typeof item.variant === "string" &&
            (item.variant === "" || id.test(item.variant)),
        )
        .map((item: { id: string; name: string; variant: string }) => ({
          id: item.id,
          name: item.name.slice(0, 100),
          variant: item.variant,
        }))
      const current: unknown = event.data.current
      state.screenCurrent = Object.fromEntries(
        Object.entries(current && typeof current === "object" ? current : {}).filter(
          ([variant, screen]) => (variant === "" || id.test(variant)) && typeof screen === "string" && id.test(screen),
        ),
      )
      // A framework can announce an empty list before it mounts: a scope is restored, and forgotten,
      // only once the frame lists screens in it.
      const restore = state.restoreScreens ?? {}
      for (const [variant, screen] of Object.entries(restore)) {
        if (!state.screens.some((item) => item.variant === variant)) continue
        delete restore[variant]
        if (
          state.screenCurrent[variant] !== screen &&
          state.screens.some((item) => item.id === screen && item.variant === variant)
        ) {
          state.screenCurrent[variant] = screen
          preview?.postMessage({ type: "design:screen", id: screen, variant, scroll: false }, "*")
        }
      }
      if (!Object.keys(restore).length) state.restoreScreens = undefined
      drawScreens()
      return
    }
    if (event.data?.type === "design:variants") {
      // A frame announces its variants once it has loaded, which is when it can take the insets.
      safeArea()
      if (event.source === element<HTMLIFrameElement>("peer-preview").contentWindow) {
        if (state.pendingOperation?.feedback.revision === state.revision) showOperation("peer-preview")
        syncPeerScreen()
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
      const latest = state.revision === state.design?.revision
      const check = state.operationCheck
      if (check && latest && state.revision !== check.revision) {
        check.unchanged = unchanged(check, state.variants)
        if (!check.unchanged) settleOperation(check.action)
        else if (check.consumed && check.working && check.idle) failOperation(copy.operationUnchanged)
      }
      // The feed can report the agent idle before the revision it published reaches the page.
      const failure = state.lastFailure
      if (failure && latest && state.revision !== failure.revision && !unchanged(failure, state.variants))
        settleOperation(failure.action)
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
        typeof item[name] === "string" ? cut(String(item[name]), limit) : ""
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
            label: field(item, "label", 240) || field(item, "tag", 64) || field(item, "target", 120),
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
      // A note revealed from the panel whose element this revision no longer has says so.
      if (feedbackView.revealing && event.data.target === feedbackView.revealing) {
        feedbackView.revealing = ""
        if (event.data.rect === null) status(copy.revealMissing, "revealMissing")
      }
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
    element("target").textContent = cut(event.data.target, 1000)
    input("selection").value = cut(event.data.text, 12000)
    state.snapshot = typeof event.data.snapshot === "string" ? cut(event.data.snapshot, 30000) : ""
    const field = (name: string, limit: number) =>
      typeof event.data[name] === "string" ? cut(String(event.data[name]), limit) : ""
    // Picking another element moves the card and keeps whatever was typed; nothing is lost by a
    // stray click and the header shows the new target.
    const moved = !!state.card?.text.trim() && state.card.target !== event.data.target
    state.card = {
      frame,
      target: cut(event.data.target, 1000),
      tag: field("tag", 64),
      elementText: field("elementText", 240),
      selectedText: field("selectedText", 12000),
      label: field("label", 240) || field("tag", 64) || "page",
      xpath: field("xpath", 2000),
      context: field("context", 240),
      parent: field("parent", 1200),
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
    const opensDialog = ["rename-variant", "split-variant", "delete-variant", "select-merge", "run-anti-slop"].includes(
      item.id,
    )
    variantMenu.close(!opensDialog)
    if (item.dataset.for) return element(item.dataset.for).click()
    if (item.id === "run-anti-slop") {
      const variant = state.variants.find((variant) => variant.id === state.variant)
      if (!variant) return
      element("anti-slop-variant").textContent = `${variant.name} · ${state.revision}`
      element<HTMLDialogElement>("anti-slop-dialog").showModal()
      input("anti-slop-text").focus()
      return
    }
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
  element("activity").hidden = !options.feed
  if (options.feed)
    options.feed(
      `${endpoint}/feed`,
      transport,
      controller.signal,
      onFeed,
      () => {
        liveness.feed = "unavailable"
        drawLiveness()
      },
      (status) => {
        liveness.feed = status
        drawLiveness()
      },
    )
  drawLoading()
  drawLiveness()
  // Elapsed times are read from the clock each second; nothing counts on its own.
  const ticker = setInterval(() => {
    // A retry countdown in the zero state is read from the clock too.
    if (loading.view.phase === "loading" || (loading.view.phase === "empty" && loading.view.until)) drawLoading()
    drawLiveness()
  }, 1000)
  void run(refresh)
  const dispose = () => {
    if (state.stopped) return
    save()
    clearInterval(ticker)
    clearTimeout(loading.reveal)
    clearTimeout(state.idleCheck)
    clearTimeout(liveness.switchedTimer)
    scheme.removeEventListener("change", syncScheme)
    schemeObserver.disconnect()
    fitting.disconnect()
    replyFit.disconnect()
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
  function closeReview() {
    const styles = [...root.querySelectorAll("style")]
    dispose()
    const message = document.createElement("p")
    message.textContent = state.captureFailed ? `${copy.approved} ${captureNotice()}` : copy.approved
    message.style.padding = "24px"
    root.append(...styles, message)
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
      for (const attribute of ["aria-label", "title", "placeholder"]) {
        root.querySelectorAll<HTMLElement>(`[data-copy-${attribute}]`).forEach((node) => {
          node.setAttribute(attribute, copy[node.getAttribute(`data-copy-${attribute}`) as keyof ReviewCopy])
        })
      }
      drawSources(state.revisionInfo)
      drawEvidence()
      drawLoading()
      // Rows and lines with counts in their text are rebuilt in the new language.
      feedbackView.rows.clear()
      feedbackView.blocks.clear()
      draftRows.clear()
      conversationView.reply = ""
      conversationView.message = ""
      conversationView.alert = ""
      livenessView.line = ""
      livenessView.stage = ""
      delete element("round-sub").dataset.signature
      drawRounds()
      drawNotes()
      drawTaskCount()
      fitReply()
      drawLiveness()
    },
  })
}

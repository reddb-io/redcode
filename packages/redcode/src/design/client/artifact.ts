/**
 * What runs inside the prototype.
 *
 * Shipped as the text of `artifactMain` (see `sdk.ts`), so this function must be self-contained:
 * it reads its helpers off the `h` parameter and touches nothing else in module scope. It can
 * highlight what the pointer is over, open a card that asks what should change, anchor a note to
 * an element, a text range, a table cell or a Mermaid node, and hand the result to the shell by
 * `postMessage`. It cannot reach the network — the serving policy forbids it — so everything it
 * says is a proposal the shell renders and a person sends.
 *
 * Its UI lives in a closed shadow root, so the prototype's CSS cannot deform it and its CSS cannot
 * leak into the page being reviewed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type * as Helpers from "./helpers"

export interface ArtifactConfig {
  /** The revision this document was served for; every message carries it back. */
  readonly load: number
}

export type HelperTable = {
  readonly [K in keyof typeof Helpers as (typeof Helpers)[K] extends (...args: any[]) => any
    ? K
    : never]: (typeof Helpers)[K]
}

export function artifactMain(config: ArtifactConfig, h: HelperTable) {
  const win = window as any
  if (win.__redcodeDesign) return
  win.__redcodeDesign = true

  const post = (type: string, payload: Record<string, unknown> = {}) =>
    parent.postMessage({ source: "redcode-design", v: 2, type, payload, load: config.load }, "*")

  let annotationMode = true
  let hovered: any = null
  let selected: any = null
  let ignoreNextClick = false
  let shadow: ShadowRoot | null = null
  let counter = 0
  let activeCard: { context: any; textarea: HTMLTextAreaElement } | null = null
  let reviewStateTimer = 0
  let draftRestoreTimer = 0
  /** How long a script-built section or a diagram gets to appear before a draft's anchor is called missing. */
  const DRAFT_ANCHOR_SETTLE_MS = 1500
  const ids = new WeakMap<object, string>()

  const uid = (el: any) => {
    if (!ids.has(el)) ids.set(el, String(++counter))
    return ids.get(el) as string
  }
  const selector = (el: any) => h.elementSelector(el)
  const isUi = (el: any) => !!(el && el.closest && el.closest("[data-redcode-ui],[data-lavish-ui]"))
  const isAction = (el: any) => !!h.closestReviewAttribute(el, "action")
  const isControl = (el: any) => h.isNativeInteractiveControl(el)
  const escapeHtml = (value: unknown) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
    )

  /** What an element is, for the transcript: uid, selector, tag, its text, and a typed target when one applies. */
  const context = (el: any, options: { table?: boolean } = {}) => {
    const base: any = {
      uid: uid(el),
      selector: selector(el),
      tag: String(el.tagName || "").toLowerCase(),
      text: String(el.innerText || el.textContent || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 240),
    }
    // Table coordinates are extra context, never a replacement identity: the highlight outlines the
    // element that was clicked, so selector, tag and text keep describing that exact element.
    const cell = options.table ? h.tableCellTarget(el, selector) : null
    if (cell) base.target = cell
    const node = h.mermaidNodeFrom(el, selector)
    if (node) {
      base.tag = "mermaid-node"
      base.text = node.label || base.text
      base.target = node
    }
    return base
  }

  /** Inside a Mermaid diagram the whole node is the target; everywhere else the element itself. */
  const annotationTargetEl = (el: any) => h.mermaidNodeElement(el) || el

  // --- highlight ---------------------------------------------------------------------------------
  const highlight = (el: any) => {
    if (!el || !el.style) return
    el.style.outline = "var(--redcode-annotate-outline,2px solid var(--redcode-accent,#f4c95d))"
    el.style.outlineOffset = "var(--redcode-annotate-offset,2px)"
  }
  const clearHighlight = (el: any) => {
    if (el && el.style) el.style.outline = ""
  }
  const clearTextHighlight = () => {
    if (!shadow) return
    for (const el of Array.from(shadow.querySelectorAll(".text-highlight"))) el.remove()
  }
  const highlightTextRange = (range: Range) => {
    clearTextHighlight()
    const root = ensureShadow()
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue
      const mark = document.createElement("div")
      mark.className = "text-highlight"
      mark.style.left = rect.left + "px"
      mark.style.top = rect.top + "px"
      mark.style.width = rect.width + "px"
      mark.style.height = rect.height + "px"
      root.appendChild(mark)
    }
  }

  // --- mode --------------------------------------------------------------------------------------
  const setAnnotationMode = (enabled: boolean) => {
    annotationMode = !!enabled
    let style = document.getElementById("redcode-design-cursor")
    if (annotationMode && !style) {
      style = document.createElement("style")
      style.id = "redcode-design-cursor"
      style.textContent =
        ":root{--redcode-accent:#f4c95d;--redcode-annotate-outline:2px solid var(--redcode-accent);--redcode-annotate-offset:2px}" +
        "*{cursor:default!important}" +
        "[data-redcode-action],[data-redcode-action] *,[data-lavish-action],[data-lavish-action] *{cursor:pointer!important}" +
        "input,textarea,[contenteditable]:not([contenteditable='false']){cursor:text!important}" +
        "button,select,label,option,input[type='button'],input[type='submit'],input[type='reset'],input[type='checkbox'],input[type='radio'],input[type='file'],input[type='color'],input[type='range'],input[type='image']{cursor:pointer!important}"
      document.head.appendChild(style)
    }
    if (!annotationMode && style) style.remove()
    if (!annotationMode) closeCard()
    post("mode", { annotate: annotationMode })
  }

  // --- the public API ----------------------------------------------------------------------------
  const queuePrompt = (prompt: unknown, options: any = {}) => {
    const origin = options.element || document.activeElement || document.body
    const item: any = { ...context(origin), prompt: String(prompt || "") }
    const queueKey = h.deriveQueueKey(origin, options)
    if (queueKey) item.queueKey = String(queueKey)
    if (options.uid) item.uid = String(options.uid)
    if (options.selector) item.selector = String(options.selector)
    if (options.tag) item.tag = String(options.tag)
    if (options.text) item.text = String(options.text)
    if (options.target) item.target = options.target
    if (options.data) item.prompt += "\n\nContext data:\n" + JSON.stringify(options.data, null, 2)
    if (Array.isArray(options.attachments) && options.attachments.length) {
      const attachments = options.attachments
        .filter((a: any) => a && a.id)
        .map((a: any) => (a.name ? { id: String(a.id), name: String(a.name) } : { id: String(a.id) }))
      if (attachments.length) item.attachments = attachments
    }
    post("queuePrompt", { prompt: item })
  }
  const sendQueuedPrompts = () => post("sendQueuedPrompts")
  const endSession = () => post("endSession")
  const setStatus = (message: unknown) => post("status", { message: String(message || "").slice(0, 200) })
  const snapshot = () => {
    const lines: string[] = []
    const walk = (el: any, depth: number) => {
      if (!(el instanceof Element) || depth > 6 || isUi(el)) return
      const c = context(el)
      const name = c.text ? ' "' + c.text.slice(0, 80).replace(/"/g, "'") + '"' : ""
      lines.push("  ".repeat(depth) + "uid=" + c.uid + " " + c.tag + name)
      for (const child of Array.from(el.children)) walk(child, depth + 1)
    }
    walk(document.body, 0)
    return lines.join("\n")
  }
  const api = { queuePrompt, sendQueuedPrompts, endSession, getQueuedPrompts: () => [], setStatus, snapshot }
  win.redcodeDesign = api
  if (!win.lavish) win.lavish = api

  // --- text ranges -------------------------------------------------------------------------------
  const closestElement = (node: any): any => {
    if (!node) return document.body
    if (node.nodeType === 1) return node
    return node.parentElement || document.body
  }
  const nodePath = (node: any, root: any) => {
    const path: number[] = []
    let current = node
    while (current && current !== root) {
      const parentNode = current.parentNode
      if (!parentNode) break
      path.unshift(Array.from(parentNode.childNodes).indexOf(current))
      current = parentNode
    }
    return path
  }
  const boundary = (node: any, offset: number) => {
    const el = closestElement(node)
    return { selector: selector(el), path: nodePath(node, el), offset: Number(offset) || 0 }
  }
  const textSelectionContext = (selection: Selection | null) => {
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const text = selection.toString().trim().replace(/\s+/g, " ")
    if (range.collapsed || !text) return null
    const ancestor = closestElement(range.commonAncestorContainer)
    if (isUi(ancestor) || isAction(ancestor) || isControl(ancestor)) return null
    const common = selector(ancestor)
    return {
      uid: "",
      selector: common,
      tag: "text",
      text: text.slice(0, 240),
      target: {
        type: "text-range",
        text,
        selector: common,
        commonAncestorSelector: common,
        start: boundary(range.startContainer, range.startOffset),
        end: boundary(range.endContainer, range.endOffset),
      },
      element: ancestor,
      range: range.cloneRange(),
    }
  }

  // --- the card ----------------------------------------------------------------------------------
  const ensureShadow = () => {
    if (shadow) return shadow
    const host = document.createElement("div")
    host.setAttribute("data-redcode-ui", "annotation-root")
    document.documentElement.appendChild(host)
    shadow = host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent =
      ":host{all:initial;position:fixed;z-index:2147483647;left:0;top:0;color-scheme:dark;" +
      "--bg:#11141a;--bg-deep:#0f1115;--fg:#f7f3ea;--fg-faint:#aeb6c6;--border:#303745;--accent:#f4c95d;--accent-hover:#ffd877;--accent-ink:#17130a;--muted:#2a2f3a;" +
      '--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-family:var(--font)}' +
      "*{box-sizing:border-box}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".text-highlight{position:fixed;pointer-events:none;background:rgba(244,201,93,.28);border-radius:2px;box-shadow:0 0 0 1px rgba(244,201,93,.45)}" +
      ".card{position:fixed;width:min(320px,calc(100vw - 24px));padding:12px;border-radius:14px;background:var(--bg);color:var(--fg);border:1px solid var(--accent);box-shadow:0 20px 70px rgba(0,0,0,.35);font:14px/1.4 var(--font)}" +
      ".heading{font-weight:700;margin-bottom:6px;word-break:break-word}" +
      ".card textarea{width:100%;min-height:86px;resize:vertical;border-radius:10px;border:1px solid var(--border);background:var(--bg-deep);color:var(--fg);padding:9px;font:inherit;font-family:var(--font)}" +
      ".card textarea::placeholder{color:var(--fg-faint)}" +
      ".hint{margin-top:6px;font-size:11px;color:var(--fg-faint)}.hint.alert{color:#ff9d7a;font-weight:700}" +
      ".row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}" +
      ".card button{border:0;border-radius:10px;padding:8px 10px;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer}" +
      ".card button:active{opacity:.85}.queue{background:var(--accent);color:var(--accent-ink)}.queue:hover{background:var(--accent-hover)}.cancel{background:var(--muted);color:var(--fg)}" +
      ".reveal{position:fixed;pointer-events:none;border:2px solid var(--accent);border-radius:4px;box-shadow:0 0 0 4px rgba(244,201,93,.22);animation:reveal 2.4s ease-out forwards}" +
      "@keyframes reveal{0%{opacity:0}12%{opacity:1}70%{opacity:1}100%{opacity:0}}"
    shadow.appendChild(style)
    return shadow
  }

  const closeCard = () => {
    activeCard = null
    if (shadow) for (const el of Array.from(shadow.querySelectorAll(".card"))) el.remove()
    clearHighlight(hovered)
    clearHighlight(selected)
    hovered = null
    selected = null
    clearTextHighlight()
    scheduleReviewStateReport()
  }

  // --- review state: what the shell replays after a reload --------------------------------------
  // Only what this client owns: an open element card's text, and the controls inside a question
  // scope. Application-owned form state is left alone, and a text-range card anchors to a live
  // Range that a reload invalidates, so it is not replayed.
  const questionControls = () => {
    const entries: { el: any; key: string; index: number; question: string; type: string }[] = []
    for (const scope of Array.from(document.querySelectorAll("[data-redcode-question],[data-lavish-question]"))) {
      const question = h.reviewAttribute(scope, "question")
      const controls = Array.from(scope.querySelectorAll("input,select,textarea"))
      controls.forEach((el, index) => {
        const control = el as any
        const type = String(control.getAttribute("type") || control.type || "text").toLowerCase()
        if (["button", "submit", "reset", "file", "image", "password"].includes(type)) return
        if (entries.length >= 200) return
        entries.push({
          el: control,
          key: [
            question,
            String(control.getAttribute("name") || control.id || ""),
            type,
            String(control.getAttribute("value") || ""),
          ]
            .join("|")
            .slice(0, 300),
          index,
          question,
          type,
        })
      })
    }
    return entries
  }
  const collectReviewState = () => {
    const text = activeCard ? String(activeCard.textarea.value || "") : ""
    return {
      card:
        activeCard && activeCard.context.tag !== "text" && text.trim()
          ? { selector: String(activeCard.context.selector || ""), text: text.slice(0, 4000) }
          : null,
      fields: questionControls().map((entry) => ({
        key: entry.key,
        index: entry.index,
        question: entry.question,
        type: entry.type,
        value: String(entry.el.value === undefined || entry.el.value === null ? "" : entry.el.value).slice(0, 2000),
        checked: entry.type === "checkbox" || entry.type === "radio" ? Boolean(entry.el.checked) : null,
      })),
    }
  }
  const scheduleReviewStateReport = () => {
    if (reviewStateTimer) window.clearTimeout(reviewStateTimer)
    reviewStateTimer = window.setTimeout(() => {
      reviewStateTimer = 0
      post("reviewState", { state: collectReviewState() })
    }, 120)
  }
  const cancelPendingDraftRestore = () => {
    if (!draftRestoreTimer) return
    window.clearTimeout(draftRestoreTimer)
    draftRestoreTimer = 0
  }
  const safeQuery = (sel: unknown): Element | null => {
    try {
      return document.querySelector(String(sel || ""))
    } catch {
      return null
    }
  }
  const restoreReviewState = (state: any) => {
    if (!state || typeof state !== "object") return
    const fields = Array.isArray(state.fields) ? state.fields : []
    if (fields.length) {
      const entries = questionControls()
      for (const field of fields) {
        const match =
          entries.find((entry) => entry.key === field.key) ||
          entries.find((entry) => entry.question === field.question && entry.index === field.index)
        if (!match) continue
        // No synthetic change/input events: the page's own handlers queue prompts, and replaying
        // them would silently re-queue answers the person already sent.
        if (field.checked === null || field.checked === undefined) match.el.value = String(field.value ?? "")
        else match.el.checked = Boolean(field.checked)
      }
    }
    const card = state.card
    if (!card || !card.selector || !String(card.text || "").trim()) return
    const target = safeQuery(card.selector)
    if (target) {
      showCard(target, { restoreText: String(card.text) })
      return
    }
    // The load event says the document parsed, not that it finished rendering. Ask again once
    // it has had time to appear; only then is the anchor's absence an answer worth reporting.
    cancelPendingDraftRestore()
    draftRestoreTimer = window.setTimeout(() => {
      draftRestoreTimer = 0
      // A card the person opened meanwhile wins: restoring over live typing destroys text.
      if (activeCard) return
      const late = safeQuery(card.selector)
      if (late) {
        showCard(late, { restoreText: String(card.text) })
        return
      }
      post("reviewDraftUnrestorable", { selector: String(card.selector) })
    }, DRAFT_ANCHOR_SETTLE_MS)
  }

  const showCard = (target: any, options: { context?: any; range?: Range; restoreText?: string } = {}) => {
    cancelPendingDraftRestore()
    const root = ensureShadow()
    closeCard()
    const c = options.context || context(target, { table: true })
    let anchor = target
    if (options.range) highlightTextRange(options.range)
    else {
      anchor = annotationTargetEl(target)
      selected = anchor
      highlight(selected)
    }
    const rect = options.range ? options.range.getBoundingClientRect() : anchor.getBoundingClientRect()
    const card = document.createElement("div")
    card.className = "card"
    const isCell = c.target && c.target.type === "table-cell"
    const cellItself = isCell && (c.tag === "td" || c.tag === "th")
    const cellLabel = isCell ? [c.target.rowLabel, c.target.columnLabel].filter(Boolean).join(" → ") : ""
    const nodeLabel = c.tag === "mermaid-node" ? (c.target && c.target.label) || c.text || "" : ""
    const heading =
      c.tag === "text"
        ? "Annotate text"
        : cellLabel
          ? cellItself
            ? "Annotate cell: " + escapeHtml(cellLabel)
            : "Annotate &lt;" + escapeHtml(c.tag) + "&gt; in " + escapeHtml(cellLabel)
          : c.tag === "mermaid-node"
            ? "Annotate node" + (nodeLabel ? ": " + escapeHtml(nodeLabel) : "")
            : "Annotate &lt;" + escapeHtml(c.tag) + "&gt;"
    const placeholder =
      c.tag === "text"
        ? "Tell the agent what to change about this text…"
        : cellItself
          ? "Tell the agent what to change about this table cell…"
          : c.tag === "mermaid-node"
            ? "Tell the agent what to change about this diagram node…"
            : "Tell the agent what to change about this element…"
    const mod = /Mac|iP(hone|ad|od)/.test(navigator.platform) ? "⌘" : "Ctrl"
    card.innerHTML =
      '<div class="heading">' +
      heading +
      '</div><textarea placeholder="' +
      placeholder +
      '"></textarea><div class="hint">Enter to queue · ' +
      mod +
      "+Enter to send · Esc to cancel</div>" +
      '<div class="row"><button class="cancel" type="button">Cancel</button><button class="queue" type="button">Queue</button></div>'
    root.appendChild(card)
    const place = () => {
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - card.offsetWidth - 12)
      const top = Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - card.offsetHeight - 12)
      card.style.left = left + "px"
      card.style.top = top + "px"
    }
    place()
    const textarea = card.querySelector("textarea") as HTMLTextAreaElement
    const cancel = card.querySelector(".cancel") as HTMLButtonElement
    const queue = card.querySelector(".queue") as HTMLButtonElement
    activeCard = { context: c, textarea }

    const tryQueue = () => {
      const prompt = textarea.value.trim()
      if (prompt) queuePrompt(prompt, { ...c, queueKey: "" })
      closeCard()
      return !!prompt
    }
    cancel.onclick = closeCard
    queue.onclick = () => void tryQueue()
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        const sendNow = (event.ctrlKey || event.metaKey) && !!textarea.value.trim()
        const queued = tryQueue()
        // postMessage delivery is ordered, so the queued prompt lands before the send.
        if (queued && sendNow) sendQueuedPrompts()
      } else if (event.key === "Escape" && !event.isComposing) {
        // Close only when there is nothing to lose.
        if (textarea.value.trim()) return
        event.preventDefault()
        closeCard()
      }
    })
    // Unsent card text is review context this client owns: reported, and replayed after a reload.
    textarea.addEventListener("input", scheduleReviewStateReport)
    if (typeof options.restoreText === "string") {
      textarea.value = options.restoreText
      scheduleReviewStateReport()
    }
    setTimeout(() => textarea.focus(), 0)
  }

  const reveal = (sel: unknown) => {
    let target: Element | null = null
    try {
      target = sel === "html" ? document.documentElement : document.querySelector(String(sel || ""))
    } catch {
      target = null
    }
    if (!(target instanceof Element)) return
    target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" })
    const root = ensureShadow()
    for (const el of Array.from(root.querySelectorAll(".reveal"))) el.remove()
    const rect = target.getBoundingClientRect()
    const marker = document.createElement("div")
    marker.className = "reveal"
    marker.style.left = rect.left + "px"
    marker.style.top = rect.top + "px"
    marker.style.width = Math.max(rect.width, 4) + "px"
    marker.style.height = Math.max(rect.height, 4) + "px"
    root.appendChild(marker)
    window.setTimeout(() => marker.remove(), 2400)
  }

  // --- events ------------------------------------------------------------------------------------
  // Capture phase, so the hotkey works wherever focus is; the shell owns the mode and echoes it back.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!h.isModeToggleHotkeyEvent(event)) return
      event.preventDefault()
      post("toggleAnnotationMode")
    },
    true,
  )

  // The frame has no origin the shell can read, so scroll position is reported and replayed.
  let scrollFrame = 0
  window.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0
        post("scroll", { x: window.scrollX, y: window.scrollY })
      })
    },
    { passive: true },
  )

  const skip = (el: any) => !annotationMode || isUi(el) || isAction(el) || isControl(el)

  document.addEventListener(
    "mouseover",
    (event) => {
      if (skip(event.target)) return
      const target = annotationTargetEl(event.target)
      if (target === selected) return
      if (hovered && hovered !== selected) clearHighlight(hovered)
      hovered = target
      highlight(hovered)
    },
    true,
  )
  document.addEventListener(
    "mouseout",
    () => {
      if (hovered && hovered !== selected) {
        clearHighlight(hovered)
        hovered = null
      }
    },
    true,
  )
  document.addEventListener(
    "mouseup",
    (event) => {
      if (skip(event.target)) return
      const c = textSelectionContext(document.getSelection())
      if (!c) return
      ignoreNextClick = true
      showCard(c.element, { context: c, range: c.range })
    },
    true,
  )
  document.addEventListener(
    "click",
    (event) => {
      const el = event.target as any
      if (!el || el.nodeType !== 1 || isUi(el)) return
      // Alt-click annotates in either mode: in explore mode it is the one way in, and it never
      // reaches a control, so the prototype keeps working under it.
      const wanted = annotationMode ? !isAction(el) && !isControl(el) : event.altKey
      if (!wanted) return
      event.preventDefault()
      event.stopPropagation()
      if (ignoreNextClick) {
        ignoreNextClick = false
        return
      }
      showCard(el)
    },
    true,
  )

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    const msg = event.data
    if (!msg || typeof msg !== "object" || msg.source !== "redcode-design-shell") return
    const payload = msg.payload || {}
    switch (msg.type) {
      case "setAnnotationMode":
        setAnnotationMode(!!payload.annotate)
        return
      case "requestSnapshot":
        post("snapshot", { snapshot: snapshot(), reason: String(payload.reason || "") })
        return
      case "restoreScroll":
        window.scrollTo(Number(payload.x) || 0, Number(payload.y) || 0)
        return
      case "revealElement":
        reveal(payload.selector)
        return
      case "restoreReviewState":
        restoreReviewState(payload.state)
        return
    }
  })

  document.addEventListener("change", (event) => {
    const el = event.target
    if (el instanceof Element && el.closest("[data-redcode-question],[data-lavish-question]"))
      scheduleReviewStateReport()
  })
  document.addEventListener("input", (event) => {
    const el = event.target
    if (el instanceof Element && el.closest("[data-redcode-question],[data-lavish-question]"))
      scheduleReviewStateReport()
  })

  const icon = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null
  setAnnotationMode(true)
  post("ready", {
    title: String(document.title || "").slice(0, 200),
    icon: icon && /^(data:|https?:|\/\/)/i.test(icon.getAttribute("href") || "") ? icon.href : "",
  })
}

/**
 * The pure half of the review client.
 *
 * Every function here is shipped to the browser by serialising it with `Function.prototype.toString`
 * (see `sdk.ts`), so each one may reference only its own arguments, browser globals, and its sibling
 * exports — never anything else in module scope. That constraint is what makes them testable here
 * with hand-built nodes and identical in the artifact, where the same declarations are pasted into
 * one scope. Ported from lavish-axi (MIT), whose review loop this mode reproduces natively.
 *
 * Parameters are typed loosely on purpose: the tests drive these with plain objects that only
 * implement the members each helper reads.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AnyEl = any

export const MODE_TOGGLE_HOTKEY_KEY = "i"

/** Cmd/Ctrl+I, and nothing that could be typing: shift and alt disqualify it. */
export function isModeToggleHotkeyEvent(event: {
  readonly key?: string
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly shiftKey?: boolean
  readonly altKey?: boolean
}): boolean {
  if (event.shiftKey || event.altKey) return false
  return Boolean(event.metaKey || event.ctrlKey) && String(event.key || "").toLowerCase() === "i"
}

/** Attribute lookup that tolerates the hand-built nodes the tests use. */
export function attributeOf(el: AnyEl, name: string): string {
  if (!el) return ""
  if (typeof el.getAttribute === "function") {
    const value = el.getAttribute(name)
    if (value !== null && value !== undefined) return String(value)
  }
  const own = el[name]
  return own === null || own === undefined ? "" : String(own)
}

/** Our attributes, with lavish's accepted as aliases so an artifact written for it still works. */
export function reviewAttribute(el: AnyEl, name: string): string {
  return attributeOf(el, "data-redcode-" + name) || attributeOf(el, "data-lavish-" + name)
}

export function closestReviewAttribute(el: AnyEl, name: string): AnyEl {
  if (!el || typeof el.closest !== "function") return null
  return el.closest("[data-redcode-" + name + "],[data-lavish-" + name + "]")
}

export function tagNameOf(el: AnyEl): string {
  return String((el && (el.tagName || el.nodeName)) || "").toLowerCase()
}

/**
 * A path a person can read and a model can find again: up to five ancestors, an id short-circuits,
 * `:nth-of-type` only when a sibling shares the tag.
 */
export function elementSelector(el: AnyEl): string {
  if (!el || !el.tagName) return ""
  const parts: string[] = []
  let node = el
  while (node && node.nodeType === 1 && parts.length < 5) {
    let part = String(node.tagName).toLowerCase()
    if (node.id) {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(node.id) : String(node.id)
      part += "#" + escaped
      parts.unshift(part)
      break
    }
    const parent = node.parentElement
    if (parent && parent.children) {
      const same = Array.from(parent.children as ArrayLike<AnyEl>).filter((x) => x.tagName === node.tagName)
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")"
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(" > ")
}

/** Elements that toggle, focus or type on their own; a click there is interaction, not annotation. */
export function isNativeInteractiveControl(el: AnyEl): boolean {
  return !!(
    el &&
    typeof el.closest === "function" &&
    el.closest(
      "button,input,select,textarea,option,optgroup,label,summary,[contenteditable]:not([contenteditable='false'])",
    )
  )
}

/**
 * The browser-only key that lets an unsent prompt replace an earlier one for the same control.
 * Explicit `queueKey` first (an empty one disables it); then the enclosing question; then radios by
 * group, checkboxes each on their own, other fields by identity; else nothing.
 */
export function deriveQueueKey(element: AnyEl, options: { readonly queueKey?: unknown } = {}): string {
  const str = (value: unknown) => (value === null || value === undefined ? "" : String(value))
  const attr = (el: AnyEl, name: string) => {
    if (!el) return ""
    if (typeof el.getAttribute === "function") {
      const value = el.getAttribute(name)
      if (value !== null && value !== undefined) return String(value)
    }
    return el[name] ? String(el[name]) : ""
  }
  const tag = (el: AnyEl) => str(el && (el.tagName || el.nodeName)).toLowerCase()
  const closest = (el: AnyEl, selector: string) =>
    el && typeof el.closest === "function" ? el.closest(selector) : null
  const path = (el: AnyEl) => {
    const parts: string[] = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = tag(node) || "element"
      const id = str(attr(node, "id") || node.id).trim()
      if (id) {
        parts.unshift(part + "#" + id)
        break
      }
      const parent = node.parentElement
      if (parent && parent.children) {
        const siblings = Array.from(parent.children as ArrayLike<AnyEl>).filter((child) => tag(child) === tag(node))
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")"
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(" > ")
  }
  const question = (el: AnyEl) => attr(el, "data-redcode-question") || attr(el, "data-lavish-question")
  const scopeKey = (el: AnyEl) => {
    const scope = closest(el, "form,fieldset") || (el && el.parentElement) || el
    const scopeTag = tag(scope) || "scope"
    const explicit = str(question(scope) || attr(scope, "id") || attr(scope, "name")).trim()
    if (explicit) return scopeTag + ":" + explicit
    return path(scope) || scopeTag
  }
  const identity = (el: AnyEl) => {
    const named = str(attr(el, "name") || attr(el, "id") || (el && el.name)).trim()
    return named || path(el)
  }

  if (options && Object.prototype.hasOwnProperty.call(options, "queueKey")) return str(options.queueKey).trim()

  const wrapper = closest(element, "[data-redcode-question],[data-lavish-question]")
  const questionKey = str(question(wrapper)).trim()
  if (questionKey) return "question:" + questionKey

  const elementTag = tag(element)
  const type = str(attr(element, "type") || (element && element.type)).toLowerCase()
  const scope = scopeKey(element)

  if (elementTag === "input" && type === "radio") {
    const name = str(attr(element, "name") || (element && element.name)).trim()
    return name ? "radio:" + scope + ":" + name : ""
  }
  if (elementTag === "input" && type === "checkbox") {
    const id = identity(element)
    const explicitValue = str(
      element && typeof element.getAttribute === "function" ? element.getAttribute("value") : "",
    ).trim()
    const option = explicitValue || str(attr(element, "id") || path(element)).trim()
    return id ? "checkbox:" + scope + ":" + id + ":" + option : ""
  }
  const keyed = !["button", "submit", "reset", "file", "image", "hidden", "radio", "checkbox"].includes(type)
  if (elementTag === "select" || elementTag === "textarea" || (elementTag === "input" && keyed)) {
    const id = identity(element)
    if (id) return "field:" + scope + ":" + id
  }
  return ""
}

// --- tables ---------------------------------------------------------------------------------------
// Positional selectors stay the locator, but a filtered or sorted table makes row numbers read
// wrong to a reviewer, so an annotation also carries the visible row and column names — and only
// when those are provable, because a confidently wrong column name is worse than none.

export function tableText(element: AnyEl): string {
  return String((element && (element.innerText || element.textContent)) || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 240)
}

/** Rows of one table only: descending into a cell would collect a nested table's rows as ours. */
export function tableRowsIn(element: AnyEl): AnyEl[] {
  const rows: AnyEl[] = []
  for (const child of Array.from(((element && element.children) || []) as ArrayLike<AnyEl>)) {
    const tag = tagNameOf(child)
    if (tag === "td" || tag === "th" || tag === "table") continue
    if (tag === "tr") rows.push(child)
    else rows.push(...tableRowsIn(child))
  }
  return rows
}

export function tableRowCells(row: AnyEl): AnyEl[] {
  return Array.from(((row && row.children) || []) as ArrayLike<AnyEl>).filter((cell) => {
    const tag = tagNameOf(cell)
    return tag === "td" || tag === "th"
  })
}

/**
 * The span the browser rendered, not the attribute string: `rowspan="2x"` spans two rows under
 * HTML's integer parsing even though `Number` reads it as NaN.
 */
export function tableSpanValue(cell: AnyEl, name: string, parsed: unknown): number | null {
  if (typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0) return parsed
  const raw = cell && typeof cell.getAttribute === "function" ? cell.getAttribute(name) : null
  const digits = /^[\t\n\f\r ]*(\d+)/.exec(String(raw ?? ""))
  return digits ? Number(digits[1]) : null
}

export function tableColumnSpan(cell: AnyEl): number {
  const span = tableSpanValue(cell, "colspan", cell && cell.colSpan)
  return span !== null && span >= 1 ? span : 1
}

/** `rowspan="0"` spans to the end of the row group; a finite span shifts only the rows it reaches. */
export function tableCellSpansRows(cell: AnyEl, rowDistance: number = 1): boolean {
  const span = tableSpanValue(cell, "rowspan", cell && cell.rowSpan)
  const rendered = span === null || span < 0 ? 1 : span
  return rendered === 0 || rendered > rowDistance
}

export function tableRowGroup(table: AnyEl, row: AnyEl): AnyEl {
  let ancestor = (row && row.parentElement) || null
  while (ancestor && ancestor !== table) {
    const tag = tagNameOf(ancestor)
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") return ancestor
    ancestor = ancestor.parentElement
  }
  return table
}

/** A span from an earlier row of this row's group means DOM order is no longer column order. */
export function tableRowIsShifted(table: AnyEl, row: AnyEl): boolean {
  if (!table || !row) return true
  const rows = tableRowsIn(tableRowGroup(table, row))
  const index = rows.indexOf(row)
  if (index < 0) return true
  for (let i = 0; i < index; i += 1) {
    for (const cell of tableRowCells(rows[i])) {
      if (tableCellSpansRows(cell, index - i)) return true
    }
  }
  return false
}

/** The header row: the last row of `<thead>`, or a first row made only of `<th>`. */
export function tableHeaderRow(table: AnyEl): AnyEl {
  const head = Array.from(((table && table.children) || []) as ArrayLike<AnyEl>).find(
    (child) => tagNameOf(child) === "thead",
  )
  if (head) return tableRowsIn(head).at(-1) || null
  const first = tableRowsIn(table)[0]
  const cells = tableRowCells(first)
  return cells.length > 0 && cells.every((cell) => tagNameOf(cell) === "th") ? first : null
}

/** A column name only when the cell's grid range matches exactly one header cell. */
export function tableColumnLabel(headerRow: AnyEl, cells: AnyEl[], index: number): string {
  if (!headerRow) return ""
  const headerCells = tableRowCells(headerRow)
  const headerWidth = headerCells.reduce((sum, cell) => sum + tableColumnSpan(cell), 0)
  const rowWidth = cells.reduce((sum, cell) => sum + tableColumnSpan(cell), 0)
  if (headerWidth === 0 || headerWidth !== rowWidth) return ""
  let start = 0
  for (let i = 0; i < index; i += 1) start += tableColumnSpan(cells[i])
  const end = start + tableColumnSpan(cells[index])
  let cursor = 0
  for (const header of headerCells) {
    const next = cursor + tableColumnSpan(header)
    if (cursor === start && next === end) return tableText(header)
    if (start < next) return ""
    cursor = next
  }
  return ""
}

export interface TableCellTarget {
  readonly type: "table-cell"
  readonly selector: string
  readonly rowLabel: string
  readonly columnLabel: string
  readonly text: string
}

export function tableCellTarget(element: AnyEl, selectorFor: (el: AnyEl) => string): TableCellTarget | null {
  const cell = element && typeof element.closest === "function" ? element.closest("td,th") : null
  const row = cell && typeof cell.closest === "function" ? cell.closest("tr") : null
  const table = row && typeof row.closest === "function" ? row.closest("table") : null
  if (!cell || !row || !table) return null
  const cells = tableRowCells(row)
  const index = cells.indexOf(cell)
  if (index < 0) return null
  const headerRow = tableHeaderRow(table)
  const shifted = tableRowIsShifted(table, row)
  const gridShifted = shifted || (headerRow ? tableRowIsShifted(table, headerRow) : false)
  const declaredHeading = cells.find(
    (candidate) => tagNameOf(candidate) === "th" && attributeOf(candidate, "scope").toLowerCase() === "row",
  )
  const allHeaderCells = cells.every((candidate) => tagNameOf(candidate) === "th")
  const inHeaderSection = headerRow === row || Boolean(typeof cell.closest === "function" && cell.closest("thead"))
  const rowHeading = inHeaderSection ? null : declaredHeading || (allHeaderCells || shifted ? null : cells[0])
  return {
    type: "table-cell",
    selector: String(selectorFor(cell) || "").slice(0, 240),
    rowLabel: tableText(rowHeading),
    columnLabel: gridShifted ? "" : tableColumnLabel(headerRow, cells, index),
    text: tableText(cell),
  }
}

// --- mermaid ---------------------------------------------------------------------------------------
// A node is anchored to Mermaid's own ids and its rendered label, not to a structural CSS path, so
// the annotation survives a re-render that reshuffles the SVG.

export function isMermaidSvg(svg: AnyEl): boolean {
  if (!svg) return false
  const id = String(svg.id || "")
  if (id.startsWith("mermaid-") || id.startsWith("mermaid_")) return true
  if (typeof svg.getAttribute === "function" && svg.getAttribute("aria-roledescription")) return true
  return !!(typeof svg.closest === "function" && svg.closest(".mermaid,[data-redcode-mermaid],[data-lavish-mermaid]"))
}

/** Multi-line labels are real `<br>`s, which textContent drops; they become spaces here. */
export function readNodeLabel(labelEl: AnyEl): string {
  if (!labelEl) return ""
  let source = labelEl
  if (typeof labelEl.querySelector === "function" && labelEl.querySelector("br") && labelEl.cloneNode) {
    source = labelEl.cloneNode(true)
    for (const br of Array.from(source.querySelectorAll("br") as ArrayLike<AnyEl>)) {
      br.replaceWith(document.createTextNode(" "))
    }
  }
  return String(source.textContent || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120)
}

export function mermaidNodeElement(el: AnyEl): AnyEl {
  if (!el || typeof el.closest !== "function") return null
  const node = el.closest("g.node, g.nodes > g")
  if (!node) return null
  const svg = node.closest("svg")
  return svg && isMermaidSvg(svg) ? node : null
}

export interface MermaidNodeTarget {
  readonly type: "mermaid-node"
  readonly diagramId: string
  readonly nodeId: string
  readonly label: string
  readonly selector: string
}

export function mermaidNodeFrom(el: AnyEl, selectorFor: (el: AnyEl) => string): MermaidNodeTarget | null {
  const node = mermaidNodeElement(el)
  if (!node) return null
  const svg = node.closest("svg")
  const labelEl = node.querySelector(".nodeLabel, .label, foreignObject span, text")
  return {
    type: "mermaid-node",
    diagramId: String((svg && svg.id) || ""),
    nodeId: String(node.id || ""),
    label: readNodeLabel(labelEl),
    selector: typeof selectorFor === "function" ? selectorFor(node) : "",
  }
}

// --- attachments ---------------------------------------------------------------------------------
// The decisions a card or a composer makes about picked, dropped and pasted files, kept pure so
// both surfaces decide the same way and a test can drive them without a browser.

/** "" when the size is fine; otherwise the line the chip shows. Decided before the file is read. */
export function attachmentSizeError(size: unknown, maxBytes: unknown): string {
  const cap = Number(maxBytes)
  if (!Number.isFinite(cap) || cap <= 0) return ""
  const n = Number(size)
  if (!Number.isFinite(n) || n <= cap) return ""
  const limit = cap >= 1024 * 1024 ? Math.round(cap / (1024 * 1024)) + " MB" : Math.round(cap / 1024) + " KB"
  return "Image is larger than the " + limit + " limit"
}

/**
 * The fate of a whole batch in one pass, so the chips render once: `skip` (wrong type), `error`
 * (too big, with the line), `cap` (would exceed the per-note count) or `accept`. The count cap is
 * honoured across the batch, not reset per file.
 */
export function classifyAttachmentBatch(
  files: ArrayLike<any> | null | undefined,
  options: { currentCount?: number; maxCount?: number; maxBytes?: number; accepted?: Record<string, boolean> } = {},
): { kind: "skip" | "error" | "cap" | "accept"; file?: any; error?: string }[] {
  const { currentCount = 0, maxCount = Infinity, maxBytes = 0, accepted = {} } = options
  const decisions: { kind: "skip" | "error" | "cap" | "accept"; file?: any; error?: string }[] = []
  let count = currentCount
  for (const file of Array.from(files || [])) {
    if (!file || !accepted[file.type]) {
      decisions.push({ kind: "skip" })
      continue
    }
    const error = attachmentSizeError(file.size, maxBytes)
    if (error) {
      decisions.push({ kind: "error", error, file })
      continue
    }
    if (count >= maxCount) {
      decisions.push({ kind: "cap" })
      continue
    }
    count += 1
    decisions.push({ kind: "accept", file })
  }
  return decisions
}

/** A drop or paste split into the images to attach and the names of what cannot be; both halves always reported. */
export function partitionDroppedFiles(
  dataTransfer: { files?: ArrayLike<any>; items?: ArrayLike<any> } | null | undefined,
  acceptedMime: Record<string, boolean>,
): { images: any[]; unsupported: string[] } {
  const accepted = acceptedMime || {}
  const images: any[] = []
  const unsupported: string[] = []
  if (!dataTransfer) return { images, unsupported }
  const files = Array.from(dataTransfer.files || []).filter(Boolean)
  for (const file of files) {
    if (accepted[file.type]) images.push(file)
    else unsupported.push(file.name || "file")
  }
  if (!files.length) {
    // Pasted screenshots arrive as items, not files, in some browsers.
    for (const item of Array.from(dataTransfer.items || [])) {
      if (!item || item.kind !== "file") continue
      if (accepted[item.type]) {
        const file = item.getAsFile()
        if (file) images.push(file)
      } else unsupported.push("file")
    }
  }
  return { images, unsupported }
}

/** One source for every surface's filter and `accept` attribute, so none offers a type another refuses. */
export function acceptedImageTypes(list: readonly string[] | null | undefined): {
  mimes: string[]
  accepted: Record<string, boolean>
  accept: string
} {
  const named = (Array.isArray(list) ? list : []).map(String).filter(Boolean)
  const mimes = named.length ? named : ["image/png", "image/jpeg", "image/webp"]
  const accepted: Record<string, boolean> = {}
  for (const mime of mimes) accepted[mime] = true
  return { mimes, accepted, accept: mimes.join(",") }
}

/**
 * A paste over a textarea: the images to attach, and whether the browser's own text paste stays.
 * A screenshot pasted alone must not also drop placeholder text in; a copied file's name or path
 * is placeholder text too. Real text beside an image is a mixed paste, and both land.
 */
export function planClipboardPaste(
  clipboardData:
    | { files?: ArrayLike<any>; items?: ArrayLike<any>; getData?: (type: string) => string }
    | null
    | undefined,
  acceptedMime: Record<string, boolean>,
): { images: any[]; keepTextPaste: boolean } {
  const { images } = partitionDroppedFiles(clipboardData, acceptedMime)
  const text = clipboardData && clipboardData.getData ? clipboardData.getData("text/plain") : ""
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const names = images.map((file) => String((file && file.name) || "")).filter(Boolean)
  const keepTextPaste =
    lines.length > 0 &&
    !(
      names.length > 0 &&
      lines.every((line) =>
        names.some((name) => line === name || line.endsWith("/" + name) || line.endsWith("\\" + name)),
      )
    )
  return { images, keepTextPaste }
}

/**
 * Whether an upload result may be applied to this document's chips: it must come from the shell,
 * and carry this document's nonce, compared by exact string identity. Chip ids restart on every
 * load, so a result still in flight across a reload could otherwise mark a new chip ready with the
 * previous document's image.
 */
export function isTrustedAttachmentResult(
  event: { source?: unknown; data?: { nonce?: unknown } } | null | undefined,
  context: { parentWindow?: unknown; nonce?: string } = {},
): boolean {
  if (!event || !context.parentWindow || event.source !== context.parentWindow) return false
  const expected = context.nonce
  if (typeof expected !== "string" || !expected) return false
  const actual = ((event.data || {}) as { nonce?: unknown }).nonce
  return typeof actual === "string" && actual === expected
}

/** The one notice line a card or composer shows about its images, derived on every render. */
export function deriveAttachmentNoticeState(
  state: {
    itemCount?: number
    maxCount?: number
    capRejected?: boolean
    queueBlocked?: boolean
    hasPending?: boolean
    hasErrors?: boolean
  } = {},
): string {
  const itemCount = Number(state.itemCount) || 0
  const maxCount = Number(state.maxCount) || 0
  if (state.queueBlocked && state.hasPending) return "Waiting for an image to finish uploading…"
  if (state.queueBlocked && state.hasErrors) return "An image couldn't be attached. Retry or remove it before queuing."
  if (state.capRejected && maxCount > 0 && itemCount >= maxCount)
    return "You can attach up to " + maxCount + " image" + (maxCount === 1 ? "" : "s") + "."
  return ""
}

/** Every helper above, in the order the bundle declares them. */
export const HELPERS = [
  isModeToggleHotkeyEvent,
  attributeOf,
  reviewAttribute,
  closestReviewAttribute,
  tagNameOf,
  elementSelector,
  isNativeInteractiveControl,
  deriveQueueKey,
  tableText,
  tableRowsIn,
  tableRowCells,
  tableSpanValue,
  tableColumnSpan,
  tableCellSpansRows,
  tableRowGroup,
  tableRowIsShifted,
  tableHeaderRow,
  tableColumnLabel,
  tableCellTarget,
  isMermaidSvg,
  readNodeLabel,
  mermaidNodeElement,
  mermaidNodeFrom,
  attachmentSizeError,
  classifyAttachmentBatch,
  partitionDroppedFiles,
  acceptedImageTypes,
  planClipboardPaste,
  isTrustedAttachmentResult,
  deriveAttachmentNoticeState,
] as const

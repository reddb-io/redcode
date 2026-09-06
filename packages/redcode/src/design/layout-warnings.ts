/**
 * The passive layout-warning inbox.
 *
 * Detection is passive: a browser diagnostic pass never wakes the agent and never triggers a
 * repair. Findings land here as durable records the person triages from the review page, and only
 * an explicit "Queue selected fixes" turns them into an ordinary queued note.
 *
 * Every rule here is a lifecycle rule, and the lifecycle is deliberately conservative: a warning is
 * only ever cleared by positive evidence — a newer prototype revision plus a complete diagnostic
 * pass for the same viewport class that no longer detects it. Absence of evidence (a failed pass, a
 * different viewport, a reload in flight, a closed drawer, a delivered note) never clears anything.
 *
 * Ported from lavish-axi's `layout-warnings.js` (MIT), with the same thresholds.
 */

import { createHash } from "node:crypto"

export const STATUSES = [
  "open",
  "queued",
  "recurring",
  "unverified",
  "reopened",
  "resolved",
  "dismissed",
  "obsolete",
] as const
export type Status = (typeof STATUSES)[number]

/** Statuses that still count as unresolved work in the badge. */
export const ACTIVE_STATUSES: readonly Status[] = ["open", "queued", "recurring", "unverified", "reopened"]

export const VIEWPORT_CLASSES = ["mobile", "compact", "desktop"] as const
export type ViewportClass = (typeof VIEWPORT_CLASSES)[number]

export const RULES = [
  "page-horizontal-overflow",
  "clipped-text",
  "clipped-control",
  "viewport-unreachable-control",
  "viewport-unreachable-content",
  "overlapping-text",
] as const

export const MAX_HISTORY = 20
export const MAX_SERIALIZED_HISTORY = 10
export const MAX_STORED = 200
export const MAX_PER_PROMPT = 50

export type Axis = "horizontal" | "vertical"

/** What the browser reports: one severe finding of one pass. */
export interface Finding {
  readonly rule: string
  readonly selector: string
  readonly axis: Axis
  readonly overflowPx: number
  readonly viewportWidth: number
}

export interface HistoryEntry {
  readonly at: string
  readonly revision: number
  readonly event: string
  readonly note?: string
}

/** The stored record. Snake case on purpose: it is the wire shape the page renders from. */
export interface Warning {
  readonly id: string
  readonly fingerprint: string
  readonly rule: string
  readonly severity: "error"
  readonly status: Status
  readonly selector: string
  readonly component: string
  readonly axis: Axis
  readonly overflow_px: number
  readonly viewport_class: ViewportClass
  readonly viewport_width: number
  readonly first_seen_at: string
  readonly first_seen_revision: number
  readonly last_seen_at: string
  readonly last_seen_revision: number
  readonly observation_count: number
  readonly queued_revision: number
  readonly queued_at: string
  readonly queue_attempts: number
  readonly dismissed_revision: number
  readonly dismissed_at?: string
  readonly resolved_at?: string
  readonly resolved_revision?: number
  readonly obsolete_reason?: string
  readonly obsolete_at?: string
  readonly history: readonly HistoryEntry[]
}

/** One completed (or failed) browser pass, as the route hands it in. */
export interface Pass {
  readonly complete?: boolean
  readonly targetPresenceComplete?: boolean
  readonly viewportWidth?: number
  readonly revision?: number
  readonly at?: string
  readonly findings?: readonly unknown[]
}

/** What the page renders: the record plus every display string, computed here. */
export interface Serialized {
  readonly id: string
  readonly fingerprint: string
  readonly rule: string
  readonly severity: "error"
  readonly status: Status
  readonly status_label: string
  readonly title: string
  readonly explanation: string
  readonly selector: string
  readonly component: string
  readonly axis: Axis
  readonly overflow_px: number
  readonly viewport_class: ViewportClass
  readonly viewport_label: string
  readonly viewport_width: number
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly last_seen_revision: number
  readonly queued_at: string
  readonly queue_attempts: number
  readonly active: boolean
  readonly selectable: boolean
  readonly outstanding: boolean
  readonly obsolete_reason?: string
  readonly history: readonly HistoryEntry[]
}

/** The structured target a queued batch carries, beside the words. */
export interface PromptTarget {
  readonly type: "layout-warnings"
  readonly artifact_revision?: number
  readonly warnings: readonly {
    readonly id: string
    readonly rule: string
    readonly selector: string
    readonly component: string
    readonly axis: Axis
    readonly overflow_px: number
    readonly viewport_class: string
    readonly viewport_width: number
    readonly status: string
    readonly last_seen_at: string
  }[]
}

export function viewportClassFor(viewportWidth: unknown): ViewportClass {
  const width = finite(viewportWidth)
  if (width <= 640) return "mobile"
  if (width <= 1024) return "compact"
  return "desktop"
}

export function viewportClassLabel(viewportClass: string): string {
  if (viewportClass === "mobile") return "Mobile"
  if (viewportClass === "compact") return "Tablet / compact"
  return "Desktop"
}

/**
 * Stable identity: the rule, the normalized target, and the viewport class. Magnitude is
 * deliberately excluded so a finding that gets worse (or slightly better) updates the one record
 * instead of inflating the count with a near-duplicate.
 */
export function fingerprint(input: { rule: string; target: string; viewportClass: string }): string {
  const payload = `${text(input.rule)}|${text(input.target)}|${text(input.viewportClass)}`
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

/** The human-readable component for a CSS path: the most specific id, then the first class, then the tag. */
export function componentIdentity(selector: string): string {
  const last = text(selector).split(">").pop()?.trim() || ""
  if (!last) return ""
  const id = last.match(/#([A-Za-z0-9_-]+)/)
  if (id) return `#${id[1]}`
  const className = last.match(/\.([A-Za-z0-9_-]+)/)
  if (className) return `.${className[1]}`
  const tag = last.match(/^([A-Za-z][A-Za-z0-9-]*)/)
  return tag ? tag[1]! : ""
}

interface Described {
  readonly axis?: string
  readonly overflowPx: number
  readonly viewportWidth: number
}

const DESCRIPTIONS: Record<string, { title: string; explain: (w: Described) => string }> = {
  "page-horizontal-overflow": {
    title: "Page scrolls sideways",
    explain: (w) =>
      `The page is ${px(w.overflowPx)} wider than the ${px(w.viewportWidth)} viewport, so content sits off-screen.`,
  },
  "clipped-text": {
    title: "Text cut off by its container",
    explain: (w) => `Rendered text crosses its container's ${edge(w.axis)} edge by ${px(w.overflowPx)} and is hidden.`,
  },
  "clipped-control": {
    title: "Control cut off by its container",
    explain: (w) =>
      `A required control crosses its container's ${edge(w.axis)} edge by ${px(w.overflowPx)}, so part of it cannot be used.`,
  },
  "viewport-unreachable-control": {
    title: "Control outside the viewport",
    explain: (w) =>
      `A required control sits ${px(w.overflowPx)} outside the ${edge(w.axis)} edge of the viewport and cannot be reached.`,
  },
  "viewport-unreachable-content": {
    title: "Text outside the viewport",
    explain: (w) =>
      `Rendered text sits ${px(w.overflowPx)} outside the ${edge(w.axis)} edge of the viewport and cannot be read.`,
  },
  "overlapping-text": {
    title: "Text covered by another element",
    explain: () => "An opaque sibling covers nearly all of this text, so it cannot be read.",
  },
}

/** Accepts the stored record (snake_case) or a raw finding (camelCase): one set of strings for both. */
export function describe(warning: Record<string, unknown> | undefined): { title: string; explanation: string } {
  const w = warning ?? {}
  const normalized: Described = {
    ...(typeof w.axis === "string" ? { axis: w.axis } : {}),
    overflowPx: finite(w.overflow_px ?? w.overflowPx),
    viewportWidth: finite(w.viewport_width ?? w.viewportWidth),
  }
  const description = DESCRIPTIONS[String(w.rule ?? w.kind ?? "")]
  if (!description) {
    return {
      title: "Layout failure",
      explanation: `The browser proved a severe layout failure on this element${normalized.overflowPx ? ` (${px(normalized.overflowPx)})` : ""}.`,
    }
  }
  return { title: description.title, explanation: description.explain(normalized) }
}

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  queued: "Queued for fix",
  recurring: "Still present",
  unverified: "Unverified",
  reopened: "Returned",
  resolved: "Resolved",
  dismissed: "Dismissed",
  obsolete: "Obsolete",
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as Status] || "Open"
}

export function isActive(warning: { readonly status?: string } | undefined): boolean {
  return ACTIVE_STATUSES.includes(String(warning?.status || "") as Status)
}

export function active(warnings: readonly Warning[]): Warning[] {
  return warnings.filter(isActive)
}

export function activeCount(warnings: readonly Warning[]): number {
  return active(warnings).length
}

/**
 * A repair request is outstanding while a queued warning has not been re-checked against a newer
 * revision. `recurring` means the newer pass still found it, so asking again is legitimate; `queued`
 * and a `queued` warning knocked to `unverified` are not. `queued_at`, not `queued_revision`, marks
 * "a repair was requested": a revision of 0 is a legitimate value.
 */
export function hasOutstandingRepairRequest(warning: Warning | undefined): boolean {
  if (!warning) return false
  if (warning.status === "queued") return true
  return warning.status === "unverified" && Boolean(warning.queued_at)
}

export function isSelectable(warning: Warning): boolean {
  return isActive(warning) && !hasOutstandingRepairRequest(warning)
}

/** Fold one completed (or failed) browser pass into the stored records. */
export function applyDiagnosticPass(warnings: unknown, pass: Pass): { warnings: Warning[]; changed: boolean } {
  const previous = normalizeStored(warnings)
  const at = String(pass.at || new Date().toISOString())
  const revision = Math.max(0, Math.trunc(finite(pass.revision)))
  const viewportWidth = finite(pass.viewportWidth)
  const viewportClass = viewportClassFor(viewportWidth)
  const complete = pass.complete !== false
  const targetPresenceComplete = pass.targetPresenceComplete === true
  const observations = new Map<string, Finding>()
  for (const finding of normalizeFindings(pass.findings, viewportWidth)) {
    const key = fingerprint({ rule: finding.rule, target: finding.selector, viewportClass })
    if (!observations.has(key)) observations.set(key, finding)
  }

  const next = previous.map((warning) => {
    // A pass for one viewport class is silent about every other class: a desktop pass can never
    // clear a phone-specific warning.
    if (warning.viewport_class !== viewportClass) return warning
    const observation = observations.get(warning.fingerprint)
    if (observation) {
      observations.delete(warning.fingerprint)
      return recordDetection(warning, observation, { at, revision, viewportWidth })
    }
    // Absence is only evidence when the pass actually completed.
    if (!complete || !targetPresenceComplete) return recordUnverified(warning, { at, revision })
    // Temporary absence within the same revision is not proof of repair.
    if (revision <= finite(warning.last_seen_revision)) return warning
    if (!isActive(warning) && warning.status !== "dismissed") return warning
    return recordResolved(warning, { at, revision })
  })

  for (const [key, observation] of observations) {
    next.push(createWarning(key, observation, { at, revision, viewportClass, viewportWidth }))
  }

  const pruned = prune(next)
  return { warnings: pruned, changed: !same(previous, pruned) }
}

/** Mark warnings as queued for repair. They stay unresolved and counted. */
export function queue(
  warnings: unknown,
  ids: readonly unknown[],
  options: { revision?: number; at?: string } = {},
): { warnings: Warning[]; queued: Warning[]; changed: boolean } {
  const revision = options.revision ?? 0
  const at = options.at ?? new Date().toISOString()
  const wanted = new Set(ids.slice(0, MAX_PER_PROMPT).map((id) => String(id)))
  const queued: Warning[] = []
  const next = normalizeStored(warnings).map((warning) => {
    if (!wanted.has(warning.id) || !isSelectable(warning)) return warning
    const updated = withHistory(
      {
        ...warning,
        status: "queued",
        queued_revision: Math.max(0, Math.trunc(finite(revision))),
        queued_at: at,
        queue_attempts: finite(warning.queue_attempts) + 1,
      },
      { at, revision, event: "queued" },
    )
    queued.push(updated)
    return updated
  })
  return { warnings: next, queued, changed: queued.length > 0 }
}

/** Dismiss a warning for the current revision only. */
export function dismiss(
  warnings: unknown,
  id: unknown,
  options: { revision?: number; at?: string } = {},
): { warnings: Warning[]; changed: boolean } {
  const revision = options.revision ?? 0
  const at = options.at ?? new Date().toISOString()
  const target = String(id || "")
  let changed = false
  const next = normalizeStored(warnings).map((warning) => {
    if (warning.id !== target || !isSelectable(warning)) return warning
    changed = true
    return withHistory(
      {
        ...warning,
        status: "dismissed",
        dismissed_revision: Math.max(0, Math.trunc(finite(revision))),
        dismissed_at: at,
      },
      { at, revision, event: "dismissed", note: "dismissed for this prototype revision" },
    )
  })
  return { warnings: next, changed }
}

/**
 * A viewport class that leaves the configured diagnostic set can never be re-checked, so its
 * warnings are marked obsolete with a reason rather than silently reading as fixed.
 */
export function markObsoleteViewports(
  warnings: unknown,
  viewportClasses: readonly string[] = VIEWPORT_CLASSES,
  options: { revision?: number; at?: string } = {},
): { warnings: Warning[]; changed: boolean } {
  const revision = options.revision ?? 0
  const at = options.at ?? new Date().toISOString()
  const configured = new Set(viewportClasses.map(String))
  let changed = false
  const next = normalizeStored(warnings).map((warning) => {
    if (configured.has(warning.viewport_class) || !isActive(warning)) return warning
    changed = true
    const reason = `the ${warning.viewport_class} viewport is no longer in the configured diagnostic set, so this warning can no longer be re-checked`
    return withHistory(
      { ...warning, status: "obsolete", obsolete_reason: reason, obsolete_at: at },
      { at, revision, event: "obsolete", note: reason },
    )
  })
  return { warnings: next, changed }
}

/** The page renders only what the server hands it, so every display string is computed here. */
export function serialize(warning: Warning): Serialized {
  const { title, explanation } = describe(warning as unknown as Record<string, unknown>)
  return {
    id: warning.id,
    fingerprint: warning.fingerprint,
    rule: warning.rule,
    severity: warning.severity,
    status: warning.status,
    status_label: statusLabel(warning.status),
    title,
    explanation,
    selector: warning.selector,
    component: warning.component,
    axis: warning.axis,
    overflow_px: warning.overflow_px,
    viewport_class: warning.viewport_class,
    viewport_label: viewportClassLabel(warning.viewport_class),
    viewport_width: warning.viewport_width,
    first_seen_at: warning.first_seen_at,
    last_seen_at: warning.last_seen_at,
    last_seen_revision: warning.last_seen_revision,
    queued_at: warning.queued_at || "",
    queue_attempts: warning.queue_attempts || 0,
    active: isActive(warning),
    selectable: isSelectable(warning),
    outstanding: hasOutstandingRepairRequest(warning),
    ...(warning.obsolete_reason ? { obsolete_reason: warning.obsolete_reason } : {}),
    history: (warning.history || []).slice(-MAX_SERIALIZED_HISTORY),
  }
}

export function serializeAll(warnings: unknown): Serialized[] {
  return normalizeStored(warnings).map(serialize)
}

/** The agent-facing payload for one queued batch. Bounded so a runaway pass can never blow up a turn. */
export function promptPayload(warnings: unknown): { prompt: string; text: string; target: PromptTarget } {
  const selected = normalizeStored(warnings).slice(0, MAX_PER_PROMPT)
  const lines = selected.map((warning, index) => {
    const { title, explanation } = describe(warning as unknown as Record<string, unknown>)
    return `${index + 1}. [${warning.id}] ${title} - ${explanation} Target: ${warning.selector || "(page)"}. Viewport: ${viewportClassLabel(warning.viewport_class)} (${px(warning.viewport_width)}). Status: ${statusLabel(warning.status)}.`
  })
  const count = selected.length
  const prompt =
    `Fix ${count === 1 ? "this layout issue" : `these ${count} layout issues`} the browser detected in this prototype:\n` +
    `${lines.join("\n")}\n\n` +
    "Apply every listed fix in one pass before saving so the review refreshes once. " +
    "A queued layout issue is a repair request, not a resolved issue: it is only marked resolved after a newer prototype revision and a complete diagnostic pass for the same viewport no longer detects it."
  const target: PromptTarget = {
    type: "layout-warnings",
    artifact_revision: Math.max(0, Math.trunc(finite(selected[0]?.queued_revision))),
    warnings: selected.map((warning) => ({
      id: warning.id,
      rule: warning.rule,
      selector: warning.selector,
      component: warning.component,
      axis: warning.axis,
      overflow_px: warning.overflow_px,
      viewport_class: warning.viewport_class,
      viewport_width: warning.viewport_width,
      status: warning.status,
      last_seen_at: warning.last_seen_at,
    })),
  }
  return {
    prompt,
    text: count === 1 ? "Layout issue: 1 selected" : `Layout issues: ${count} selected`,
    target,
  }
}

/** Target normalization for the queued batch, mirroring the other structured targets. */
export function normalizeTarget(target: unknown): PromptTarget {
  const t = (target && typeof target === "object" ? target : {}) as Record<string, unknown>
  const warnings = Array.isArray(t.warnings) ? t.warnings : []
  const normalized: PromptTarget = {
    type: "layout-warnings",
    warnings: warnings.slice(0, MAX_PER_PROMPT).map((raw) => {
      const w = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
      return {
        id: text(w.id).slice(0, 64),
        rule: text(w.rule).slice(0, 64),
        selector: text(w.selector).slice(0, 300),
        component: text(w.component).slice(0, 120),
        axis: w.axis === "vertical" ? "vertical" : "horizontal",
        overflow_px: finite(w.overflow_px),
        viewport_class: text(w.viewport_class).slice(0, 16),
        viewport_width: finite(w.viewport_width),
        status: text(w.status).slice(0, 16),
        last_seen_at: text(w.last_seen_at).slice(0, 40),
      }
    }),
  }
  if (Object.hasOwn(t, "artifact_revision")) {
    return { ...normalized, artifact_revision: Math.max(0, Math.trunc(finite(t.artifact_revision))) }
  }
  return normalized
}

/** The viewport classes a review audits, from config; nonsense falls back to every class. */
export function resolveViewportClasses(configured: readonly unknown[] | undefined): ViewportClass[] {
  if (!configured || !Array.isArray(configured)) return [...VIEWPORT_CLASSES]
  const kept = configured
    .map((value) => String(value).trim().toLowerCase())
    .filter((value): value is ViewportClass => (VIEWPORT_CLASSES as readonly string[]).includes(value))
  return kept.length ? [...new Set(kept)] : [...VIEWPORT_CLASSES]
}

/** Records with an id are records; anything else (a legacy shape, a stray value) is dropped. */
export function normalizeStored(warnings: unknown): Warning[] {
  if (!Array.isArray(warnings)) return []
  return warnings.filter(
    (warning): warning is Warning =>
      !!warning && typeof warning === "object" && !Array.isArray(warning) && !!(warning as Warning).id,
  )
}

// ---------------------------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------------------------

function createWarning(
  key: string,
  observation: Finding,
  input: { at: string; revision: number; viewportClass: ViewportClass; viewportWidth: number },
): Warning {
  return withHistory(
    {
      id: key,
      fingerprint: key,
      rule: observation.rule,
      severity: "error",
      status: "open",
      selector: observation.selector,
      component: componentIdentity(observation.selector),
      axis: observation.axis,
      overflow_px: observation.overflowPx,
      viewport_class: input.viewportClass,
      viewport_width: input.viewportWidth,
      first_seen_at: input.at,
      first_seen_revision: input.revision,
      last_seen_at: input.at,
      last_seen_revision: input.revision,
      observation_count: 1,
      queued_revision: 0,
      queued_at: "",
      queue_attempts: 0,
      dismissed_revision: 0,
      history: [],
    },
    { at: input.at, revision: input.revision, event: "detected" },
  )
}

function recordDetection(
  warning: Warning,
  observation: Finding,
  input: { at: string; revision: number; viewportWidth: number },
): Warning {
  const status = detectedStatus(warning, input.revision)
  // Re-observing the identical finding on the revision that already recorded it changes nothing.
  // Returning the record untouched keeps repeat passes from rewriting state.
  const unchanged =
    status === warning.status &&
    input.revision <= finite(warning.last_seen_revision) &&
    warning.selector === observation.selector &&
    warning.axis === observation.axis &&
    finite(warning.overflow_px) === observation.overflowPx &&
    finite(warning.viewport_width) === input.viewportWidth
  if (unchanged) return warning

  const updated: Warning = {
    ...warning,
    rule: observation.rule,
    selector: observation.selector,
    component: componentIdentity(observation.selector),
    axis: observation.axis,
    overflow_px: observation.overflowPx,
    viewport_width: input.viewportWidth,
    last_seen_at: input.at,
    last_seen_revision: Math.max(finite(warning.last_seen_revision), input.revision),
    observation_count: finite(warning.observation_count) + 1,
    status,
  }
  if (status === warning.status) return updated
  const note =
    status === "recurring"
      ? "still present after a newer prototype revision"
      : status === "reopened"
        ? "detected again after being resolved"
        : ""
  return withHistory(updated, { at: input.at, revision: input.revision, event: status, note })
}

function detectedStatus(warning: Warning, revision: number): Status {
  if (warning.status === "dismissed" && revision <= finite(warning.dismissed_revision)) return "dismissed"
  if (warning.queued_at) return revision > finite(warning.queued_revision) ? "recurring" : "queued"
  if (warning.status === "resolved") return "reopened"
  if (warning.status === "reopened") return "reopened"
  return "open"
}

function recordUnverified(warning: Warning, input: { at: string; revision: number }): Warning {
  if (!isActive(warning) || warning.status === "unverified") return warning
  return withHistory(
    { ...warning, status: "unverified" },
    {
      at: input.at,
      revision: input.revision,
      event: "unverified",
      note: "a diagnostic pass failed or was incomplete, so this warning was preserved rather than cleared",
    },
  )
}

function recordResolved(warning: Warning, input: { at: string; revision: number }): Warning {
  return withHistory(
    {
      ...warning,
      status: "resolved",
      resolved_at: input.at,
      resolved_revision: input.revision,
      queued_revision: 0,
      queued_at: "",
    },
    {
      at: input.at,
      revision: input.revision,
      event: "resolved",
      note: "absent from a complete pass on a newer prototype revision",
    },
  )
}

function withHistory(warning: Warning, entry: { at: string; revision: number; event: string; note?: string }): Warning {
  const history: HistoryEntry[] = [
    ...(Array.isArray(warning.history) ? warning.history : []),
    {
      at: String(entry.at),
      revision: Math.max(0, Math.trunc(finite(entry.revision))),
      event: String(entry.event),
      ...(entry.note ? { note: String(entry.note).slice(0, 200) } : {}),
    },
  ]
  return { ...warning, history: history.slice(-MAX_HISTORY) }
}

/** Keep every unresolved record; trim the closed tail so history stays bounded. */
function prune(warnings: Warning[]): Warning[] {
  if (warnings.length <= MAX_STORED) return warnings
  const live = warnings.filter(isActive)
  const closed = warnings.filter((warning) => !isActive(warning))
  const room = Math.max(0, MAX_STORED - live.length)
  const keptClosed = new Set(closed.slice(-room))
  return warnings.filter((warning) => isActive(warning) || keptClosed.has(warning))
}

function normalizeFindings(findings: readonly unknown[] | undefined, viewportWidth: number): Finding[] {
  if (!Array.isArray(findings)) return []
  return findings
    .filter(
      (finding): finding is Record<string, unknown> =>
        !!finding &&
        typeof finding === "object" &&
        !Array.isArray(finding) &&
        String((finding as Record<string, unknown>).severity || "").toLowerCase() === "error",
    )
    .slice(0, MAX_STORED)
    .map((finding) => ({
      rule: text(finding.kind ?? finding.rule ?? "layout-failure").slice(0, 64),
      selector: text(finding.selector).slice(0, 300),
      axis: finding.axis === "vertical" ? ("vertical" as const) : ("horizontal" as const),
      overflowPx: Math.round(finite(finding.overflowPx ?? finding.overflow_px)),
      viewportWidth: Math.round(finite(finding.viewportWidth ?? finding.viewport_width) || viewportWidth),
    }))
}

function same(previous: readonly Warning[], next: readonly Warning[]): boolean {
  return JSON.stringify(previous) === JSON.stringify(next)
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim()
}

function finite(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function px(value: unknown): string {
  return `${Math.round(finite(value))}px`
}

function edge(axis: string | undefined): string {
  return axis === "vertical" ? "bottom" : "right"
}

export * as DesignLayoutWarnings from "./layout-warnings"

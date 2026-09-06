import { describe, expect, test } from "bun:test"
import { DesignLayoutWarnings as W } from "@/design/layout-warnings"

// Ported from lavish-axi's layout-warnings tests: the lifecycle is the contract.

const OVERFLOW = {
  selector: "html",
  kind: "page-horizontal-overflow",
  axis: "horizontal",
  overflowPx: 120,
  severity: "error",
}
const CLIPPED = { selector: "p#copy", kind: "clipped-text", axis: "vertical", overflowPx: 27, severity: "error" }

function pass(
  findings: readonly unknown[],
  options: {
    revision?: number
    viewportWidth?: number
    complete?: boolean
    targetPresenceComplete?: boolean
    at?: string
  } = {},
): W.Pass {
  return {
    findings,
    revision: options.revision ?? 1,
    viewportWidth: options.viewportWidth ?? 1440,
    complete: options.complete ?? true,
    targetPresenceComplete: options.targetPresenceComplete ?? true,
    at: options.at ?? "2026-07-30T00:00:00.000Z",
  }
}

const detect = (findings: readonly unknown[], options?: Parameters<typeof pass>[1]) =>
  W.applyDiagnosticPass([], pass(findings, options)).warnings

describe("identity", () => {
  test("viewport classes bucket by width", () => {
    expect(W.viewportClassFor(390)).toBe("mobile")
    expect(W.viewportClassFor(640)).toBe("mobile")
    expect(W.viewportClassFor(820)).toBe("compact")
    expect(W.viewportClassFor(1440)).toBe("desktop")
  })

  test("the fingerprint is rule + target + viewport and ignores magnitude", () => {
    const base = { rule: "clipped-text", target: "p#copy", viewportClass: "mobile" }
    expect(W.fingerprint(base)).toBe(W.fingerprint({ ...base }))
    expect(W.fingerprint(base)).not.toBe(W.fingerprint({ ...base, viewportClass: "desktop" }))
    expect(W.fingerprint(base)).not.toBe(W.fingerprint({ ...base, target: "p#other" }))
    expect(W.fingerprint(base)).not.toBe(W.fingerprint({ ...base, rule: "clipped-control" }))
  })

  test("component identity prefers the most specific id, then class, then tag", () => {
    expect(W.componentIdentity("html > body > p#copy")).toBe("#copy")
    expect(W.componentIdentity("main > div.card")).toBe(".card")
    expect(W.componentIdentity("main > section:nth-of-type(2)")).toBe("section")
    expect(W.componentIdentity("")).toBe("")
  })

  test("every audit rule has human-readable context", () => {
    for (const rule of W.RULES) {
      const described = W.describe({ rule, overflow_px: 24, viewport_width: 390, axis: "horizontal" })
      if (rule !== "overlapping-text") expect(described.explanation).toMatch(/24px/)
      expect(described.title.length).toBeGreaterThan(0)
      expect(described.explanation.length).toBeGreaterThan(0)
    }
    expect(W.describe({ rule: "something-new" }).title).toBe("Layout failure")
  })
})

describe("the lifecycle", () => {
  test("a repeated observation of the same fingerprint updates one record", () => {
    const first = W.applyDiagnosticPass([], pass([OVERFLOW]))
    expect(first.warnings.length).toBe(1)
    expect(first.changed).toBe(true)

    const again = W.applyDiagnosticPass(first.warnings, pass([OVERFLOW]))
    expect(again.warnings.length).toBe(1)
    // An identical repeat must not churn the record.
    expect(again.changed).toBe(false)

    const worse = W.applyDiagnosticPass(again.warnings, pass([{ ...OVERFLOW, overflowPx: 400 }]))
    expect(worse.warnings.length).toBe(1)
    expect(worse.warnings[0]!.overflow_px).toBe(400)
    expect(W.activeCount(worse.warnings)).toBe(1)
  })

  test("a warning is not resolved by a repeat pass on the same revision", () => {
    const detected = detect([OVERFLOW], { revision: 3 })
    const sameRevision = W.applyDiagnosticPass(detected, pass([], { revision: 3 }))
    expect(sameRevision.warnings[0]!.status).toBe("open")
    expect(W.activeCount(sameRevision.warnings)).toBe(1)
  })

  test("a newer complete matching-viewport pass without the finding resolves it", () => {
    const detected = detect([OVERFLOW], { revision: 3 })
    const resolved = W.applyDiagnosticPass(detected, pass([], { revision: 4 }))
    expect(resolved.warnings[0]!.status).toBe("resolved")
    expect(W.activeCount(resolved.warnings)).toBe(0)
    expect(resolved.warnings[0]!.history.some((entry) => entry.event === "resolved")).toBe(true)
  })

  test("absence without target-presence completeness stays unverified", () => {
    const detected = detect([OVERFLOW], { revision: 3 })
    const transient = W.applyDiagnosticPass(detected, pass([], { revision: 4, targetPresenceComplete: false }))
    expect(transient.warnings[0]!.status).toBe("unverified")
    expect(W.activeCount(transient.warnings)).toBe(1)
    const stable = W.applyDiagnosticPass(transient.warnings, pass([], { revision: 5 }))
    expect(stable.warnings[0]!.status).toBe("resolved")
  })

  test("a different viewport class can never clear a warning", () => {
    const mobile = detect([OVERFLOW], { revision: 3, viewportWidth: 390 })
    const desktopPass = W.applyDiagnosticPass(mobile, pass([], { revision: 9, viewportWidth: 1440 }))
    expect(desktopPass.warnings[0]!.status).toBe("open")
    expect(desktopPass.changed).toBe(false)
    expect(W.activeCount(desktopPass.warnings)).toBe(1)
  })

  test("a failed or incomplete pass preserves the warning as unverified", () => {
    const detected = detect([OVERFLOW], { revision: 3 })
    const failed = W.applyDiagnosticPass(detected, pass([], { revision: 4, complete: false }))
    expect(failed.warnings[0]!.status).toBe("unverified")
    expect(W.activeCount(failed.warnings)).toBe(1)
    const recovered = W.applyDiagnosticPass(failed.warnings, pass([OVERFLOW], { revision: 5 }))
    expect(recovered.warnings[0]!.status).toBe("open")
  })

  test("queueing marks an outstanding repair request without resolving anything", () => {
    const detected = detect([OVERFLOW, CLIPPED], { revision: 2 })
    const ids = detected.map((warning) => warning.id)
    const queued = W.queue(detected, [ids[0]], { revision: 2 })
    expect(queued.queued.length).toBe(1)
    expect(queued.warnings[0]!.status).toBe("queued")
    expect(queued.warnings[1]!.status).toBe("open")
    expect(W.activeCount(queued.warnings)).toBe(2)
    expect(W.hasOutstandingRepairRequest(queued.warnings[0])).toBe(true)
    expect(W.isSelectable(queued.warnings[0]!)).toBe(false)
    expect(W.isSelectable(queued.warnings[1]!)).toBe(true)
  })

  test("a queued warning still present on a newer revision becomes recurring and re-queueable", () => {
    const detected = detect([OVERFLOW], { revision: 2 })
    const queued = W.queue(detected, [detected[0]!.id], { revision: 2 }).warnings
    const recurring = W.applyDiagnosticPass(queued, pass([OVERFLOW], { revision: 3 }))
    expect(recurring.warnings[0]!.status).toBe("recurring")
    expect(W.activeCount(recurring.warnings)).toBe(1)
    expect(W.isSelectable(recurring.warnings[0]!)).toBe(true)
    expect(recurring.warnings[0]!.history.some((entry) => entry.event === "queued")).toBe(true)
    expect(recurring.warnings[0]!.history.some((entry) => entry.event === "recurring")).toBe(true)
    const requeued = W.queue(recurring.warnings, [recurring.warnings[0]!.id], { revision: 3 })
    expect(requeued.warnings[0]!.queue_attempts).toBe(2)
  })

  test("a queued warning knocked to unverified is not re-requestable and returns to queued", () => {
    const detected = detect([OVERFLOW], { revision: 2 })
    const queued = W.queue(detected, [detected[0]!.id], { revision: 2 }).warnings
    const unverified = W.applyDiagnosticPass(queued, pass([], { revision: 2, complete: false })).warnings
    expect(unverified[0]!.status).toBe("unverified")
    expect(W.isSelectable(unverified[0]!)).toBe(false)
    const stillQueued = W.applyDiagnosticPass(unverified, pass([OVERFLOW], { revision: 2 })).warnings
    expect(stillQueued[0]!.status).toBe("queued")
  })

  test("a queued warning cannot be dismissed", () => {
    const detected = detect([OVERFLOW], { revision: 2 })
    const queued = W.queue(detected, [detected[0]!.id], { revision: 2 }).warnings
    const dismissed = W.dismiss(queued, queued[0]!.id, { revision: 2 })
    expect(dismissed.changed).toBe(false)
    expect(dismissed.warnings[0]!.status).toBe("queued")
    expect(W.activeCount(dismissed.warnings)).toBe(1)
  })

  test("a resolved warning that returns on a later revision reopens with bounded history", () => {
    const detected = detect([OVERFLOW], { revision: 2 })
    const resolved = W.applyDiagnosticPass(detected, pass([], { revision: 3 })).warnings
    expect(resolved[0]!.status).toBe("resolved")
    const reopened = W.applyDiagnosticPass(resolved, pass([OVERFLOW], { revision: 4 })).warnings
    expect(reopened[0]!.status).toBe("reopened")
    expect(W.activeCount(reopened)).toBe(1)
    expect(reopened[0]!.history.map((entry) => entry.event)).toEqual(["detected", "resolved", "reopened"])
    expect(reopened[0]!.history.length).toBeLessThanOrEqual(20)
  })

  test("history stays bounded across many transitions", () => {
    let warnings = detect([OVERFLOW], { revision: 1 })
    for (let revision = 2; revision < 40; revision += 1) {
      warnings = W.applyDiagnosticPass(warnings, pass(revision % 2 === 0 ? [] : [OVERFLOW], { revision })).warnings
    }
    expect(warnings[0]!.history.length).toBeLessThanOrEqual(20)
  })

  test("dismissal only hides the warning for the current revision", () => {
    const detected = detect([OVERFLOW], { revision: 5 })
    const dismissed = W.dismiss(detected, detected[0]!.id, { revision: 5 })
    expect(dismissed.warnings[0]!.status).toBe("dismissed")
    expect(W.activeCount(dismissed.warnings)).toBe(0)
    const sameRevision = W.applyDiagnosticPass(dismissed.warnings, pass([OVERFLOW], { revision: 5 }))
    expect(sameRevision.warnings[0]!.status).toBe("dismissed")
    const laterRevision = W.applyDiagnosticPass(sameRevision.warnings, pass([OVERFLOW], { revision: 6 }))
    expect(laterRevision.warnings[0]!.status).toBe("open")
    expect(W.activeCount(laterRevision.warnings)).toBe(1)
  })

  test("a viewport removed from the diagnostic set is marked obsolete with a reason", () => {
    const mobile = detect([OVERFLOW], { revision: 1, viewportWidth: 390 })
    const obsolete = W.markObsoleteViewports(mobile, ["desktop"], { revision: 2 })
    expect(obsolete.changed).toBe(true)
    expect(obsolete.warnings[0]!.status).toBe("obsolete")
    expect(obsolete.warnings[0]!.obsolete_reason).toMatch(/no longer in the configured diagnostic set/)
    expect(W.activeCount(obsolete.warnings)).toBe(0)
  })

  test("the configured viewport set falls back to every class", () => {
    expect(W.resolveViewportClasses(undefined)).toEqual(["mobile", "compact", "desktop"])
    expect(W.resolveViewportClasses(["desktop", " Mobile "])).toEqual(["desktop", "mobile"])
    expect(W.resolveViewportClasses(["nonsense"])).toEqual(["mobile", "compact", "desktop"])
  })

  test("a repair request is tracked by queue time, so revision 0 is not read as never queued", () => {
    const detected = detect([OVERFLOW], { revision: 0 })
    const queued = W.queue(detected, [detected[0]!.id], { revision: 0 }).warnings
    expect(queued[0]!.status).toBe("queued")
    expect(W.hasOutstandingRepairRequest(queued[0])).toBe(true)
    expect(W.isSelectable(queued[0]!)).toBe(false)
    const recurring = W.applyDiagnosticPass(queued, pass([OVERFLOW], { revision: 1 })).warnings
    expect(recurring[0]!.status).toBe("recurring")
  })
})

describe("what leaves the module", () => {
  test("the queued prompt payload carries bounded structured detail", () => {
    const detected = detect([OVERFLOW, CLIPPED], { revision: 2 })
    const payload = W.promptPayload(detected)
    expect(payload.prompt).toMatch(/Fix these 2 layout issues/)
    expect(payload.prompt).toContain(detected[0]!.id)
    expect(payload.prompt).toMatch(/one pass before saving so the review refreshes once/)
    expect(payload.prompt).toMatch(/not a resolved issue/)
    expect(payload.text).toBe("Layout issues: 2 selected")
    expect(payload.target.type).toBe("layout-warnings")
    expect(payload.target.warnings.length).toBe(2)
    expect(payload.target.warnings[1]!.rule).toBe("clipped-text")
    const queued = W.queue(
      detected,
      detected.map((warning) => warning.id),
      { revision: 2 },
    )
    expect(W.promptPayload(queued.queued).target.artifact_revision).toBe(2)
  })

  test("queueing more than one prompt batch leaves overflow selections selectable", () => {
    const warnings = detect(
      Array.from({ length: 60 }, (_, index) => ({ ...OVERFLOW, selector: `p#item-${index}` })),
      { revision: 2 },
    )
    const queued = W.queue(
      warnings,
      warnings.map((warning) => warning.id),
      { revision: 2 },
    )
    expect(queued.queued.length).toBe(50)
    expect(queued.warnings.filter((warning) => warning.status === "queued").length).toBe(50)
    expect(queued.warnings.filter((warning) => warning.status === "open").length).toBe(10)
    expect(W.promptPayload(queued.queued).target.warnings.length).toBe(50)
  })

  test("a queued prompt target is normalized and bounded", () => {
    const normalized = W.normalizeTarget({
      type: "layout-warnings",
      artifact_revision: 7,
      warnings: Array.from({ length: 80 }, (_, index) => ({
        id: `id-${index}`,
        rule: "clipped-text",
        selector: "x".repeat(600),
        axis: "sideways",
        overflow_px: "nope",
      })),
    })
    expect(normalized.warnings.length).toBe(50)
    expect(normalized.warnings[0]!.selector.length).toBe(300)
    expect(normalized.warnings[0]!.axis).toBe("horizontal")
    expect(normalized.warnings[0]!.overflow_px).toBe(0)
    expect(normalized.artifact_revision).toBe(7)
  })

  test("stored records describe their real magnitude, not a zero", () => {
    const [warning] = W.serializeAll(detect([CLIPPED], { revision: 1, viewportWidth: 1080 }))
    expect(warning!.explanation).toMatch(/27px/)
    expect(warning!.explanation).toMatch(/bottom edge/)
  })

  test("serialized warnings carry everything the drawer renders", () => {
    const [warning] = W.serializeAll(detect([CLIPPED], { revision: 1, viewportWidth: 390 }))
    expect(warning!.status_label).toBe("Open")
    expect(warning!.viewport_label).toBe("Mobile")
    expect(warning!.viewport_width).toBe(390)
    expect(warning!.component).toBe("#copy")
    expect(warning!.title).toBeTruthy()
    expect(warning!.explanation).toBeTruthy()
    expect(warning!.last_seen_at).toBeTruthy()
    expect(warning!.active).toBe(true)
    expect(warning!.selectable).toBe(true)
  })

  test("legacy stored records without an id are dropped rather than shown", () => {
    const legacy = [{ selector: "html", kind: "page-horizontal-overflow", severity: "error" }]
    expect(W.serializeAll(legacy)).toEqual([])
    expect(W.applyDiagnosticPass(legacy, pass([])).warnings.length).toBe(0)
  })

  test("every declared status has a label and a defined active/closed meaning", () => {
    for (const status of W.STATUSES) {
      expect(W.statusLabel(status)).toBeDefined()
      expect(typeof W.isActive({ status })).toBe("boolean")
    }
    expect(W.STATUSES.filter((status) => W.isActive({ status }))).toEqual([...W.ACTIVE_STATUSES])
  })
})

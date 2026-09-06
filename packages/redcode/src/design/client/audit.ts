/**
 * The passive layout audit, run inside the prototype.
 *
 * Shipped as the text of `artifactAudit` (see `sdk.ts`), so it must be self-contained: it reads
 * its helpers and its outlet off the `deps` parameter and touches nothing else in module scope.
 *
 * It measures what the browser actually laid out — text fragments, control boxes, the page's
 * scroll width — after fonts, geometry and finite animations settle, samples twice and keeps only
 * what both samples agree on, and reports the result to the shell as a diagnostic pass. It never
 * decides anything: a pass is evidence the inbox weighs, and an incomplete pass says so about
 * itself. Every suppression here (diagrams, visually-hidden text, intentional truncation, real
 * scrollers, elements in motion) is a way of staying silent rather than being wrong.
 *
 * Ported from lavish-axi's artifact SDK with the same timings and thresholds.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { HelperTable } from "./artifact"

export interface AuditDeps {
  readonly h: HelperTable
  /** Send a message to the shell; the SDK stamps the load on it. */
  readonly post: (type: string, payload?: Record<string, unknown>) => void
  /** Our own UI, which is never audited. */
  readonly isUi: (el: any) => boolean
  readonly selector: (el: any) => string
  /** The revision this document was served for, echoed on every pass. */
  readonly load: number
}

export function artifactAudit(deps: AuditDeps) {
  const h = deps.h
  const SETTLE_MS = 180
  const MAX_WAIT_MS = 2000
  const ANIMATION_MAX_WAIT_MS = 4000
  const STABLE_SAMPLE_MS = 120
  const MAX_ELEMENTS = 800

  let run = 0
  let timer = 0
  let passSequence = 0
  let publishRequested = false
  let lastSignature = ""

  type Finding = {
    selector: string
    kind: string
    axis: "horizontal" | "vertical"
    overflowPx: number
    viewportWidth: number
    severity: "error"
  }
  type Rect = { left: number; right: number; top: number; bottom: number; width?: number; height?: number }

  const toPx = (value: unknown) => {
    const parsed = Number.parseFloat(String(value || "0"))
    return Number.isFinite(parsed) ? parsed : 0
  }
  const rounded = (value: number) => Math.round(Math.max(0, value) * 10) / 10
  const elementText = (el: any) =>
    String((el && (el.innerText || el.textContent)) || "")
      .trim()
      .replace(/\s+/g, " ")
  const directText = (el: any) =>
    Array.from((el && el.childNodes) || [])
      .filter((node: any) => node.nodeType === 3)
      .map((node: any) => String(node.textContent || ""))
      .join(" ")
      .trim()
      .replace(/\s+/g, " ")

  const isRequiredControl = (el: any) => {
    if (
      !el ||
      !el.matches ||
      !el.matches("button,input,select,textarea,a[href],summary,[data-redcode-action],[data-lavish-action],[role]")
    )
      return false
    if (el.matches("input[type='hidden'],[disabled],[aria-disabled='true']")) return false
    if (!el.hasAttribute("role")) return true
    return ["button", "link", "checkbox", "radio", "switch", "textbox", "combobox"].includes(
      String(el.getAttribute("role") || "").toLowerCase(),
    )
  }
  const isSemanticTextBoundary = (el: any) =>
    !!(
      el &&
      el.matches &&
      el.matches(
        "p,h1,h2,h3,h4,h5,h6,button,label,a[href],li,dt,dd,th,td,legend,figcaption,summary,[role='button'],[role='link'],[role='alert'],[role='status']",
      )
    )
  const hasSemanticTextBoundaryAncestor = (el: any) => {
    let node = el && el.parentElement
    while (node && node !== document.body && node !== document.documentElement) {
      if (isSemanticTextBoundary(node)) return true
      node = node.parentElement
    }
    return false
  }
  const auditedText = (el: any) => (isSemanticTextBoundary(el) ? elementText(el) : directText(el))
  const rectArea = (rect: DOMRect) => Math.max(0, rect.width) * Math.max(0, rect.height)

  const isVisible = (el: any, rect: DOMRect = el.getBoundingClientRect()) => {
    if (!el || deps.isUi(el) || rect.width <= 0 || rect.height <= 0) return false
    let node = el
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node)
      const opacity = Number.parseFloat(style.opacity || "1")
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        (style as any).contentVisibility === "hidden" ||
        (Number.isFinite(opacity) && opacity <= 0.01)
      )
        return false
      node = node.parentElement
    }
    return true
  }
  const isHorizontalScroller = (el: any) => {
    if (!el || el === document.body || el === document.documentElement) return false
    const overflowX = getComputedStyle(el).overflowX
    return overflowX === "auto" || overflowX === "scroll"
  }
  const isVerticalScroller = (el: any) => {
    if (!el || el === document.body || el === document.documentElement) return false
    const overflowY = getComputedStyle(el).overflowY
    return overflowY === "auto" || overflowY === "scroll"
  }
  const hasHorizontalScrollerAncestor = (el: any) => {
    let node = el
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (isHorizontalScroller(node)) return true
      node = node.parentElement
    }
    return false
  }
  const hasReachableVerticalScrollerAncestor = (el: any) => {
    let node = el && el.parentElement
    while (node && node !== document.body && node !== document.documentElement) {
      if (isVerticalScroller(node)) {
        const rect = node.getBoundingClientRect()
        if (rect.bottom > 0 && rect.top < (window.innerHeight || 0)) return true
      }
      node = node.parentElement
    }
    return false
  }
  const rootVerticalScrollLocked = () =>
    [document.documentElement, document.body]
      .filter(Boolean)
      .map((node) => getComputedStyle(node).overflowY)
      .some((value) => value === "hidden" || value === "clip")
  const paddingBox = (el: any): Rect => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      left: rect.left + toPx(style.borderLeftWidth),
      right: rect.right - toPx(style.borderRightWidth),
      top: rect.top + toPx(style.borderTopWidth),
      bottom: rect.bottom - toPx(style.borderBottomWidth),
    }
  }
  const textNodes = (el: any) => {
    const descendants = isSemanticTextBoundary(el)
    const nodes: any[] = []
    const pending: any[] = Array.from((el && el.childNodes) || [])
    while (pending.length > 0) {
      const node = pending.shift()
      if (!node) continue
      if (node.nodeType === 3) {
        if (String(node.textContent || "").trim()) nodes.push(node)
      } else if (descendants && node.nodeType === 1) {
        pending.unshift(...Array.from(node.childNodes || []))
      }
    }
    return nodes
  }
  const textFragments = (el: any): DOMRect[] => {
    const fragments: DOMRect[] = []
    for (const node of textNodes(el)) {
      const range = document.createRange()
      range.selectNodeContents(node)
      fragments.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0))
      if (range.detach) range.detach()
    }
    return fragments
  }
  const isTruncation = (style: CSSStyleDeclaration) =>
    style.textOverflow === "ellipsis" || Number.parseInt((style as any).webkitLineClamp || "0", 10) > 0
  const hasVisualMask = (style: CSSStyleDeclaration) => {
    const maskImage = String((style as any).maskImage || (style as any).webkitMaskImage || "none").toLowerCase()
    const clipPath = String(style.clipPath || "none").toLowerCase()
    return (maskImage !== "none" && maskImage !== "") || (clipPath !== "none" && clipPath !== "")
  }
  const isRoundedOverflowMask = (style: CSSStyleDeclaration) => {
    const clips =
      style.overflowX === "hidden" ||
      style.overflowX === "clip" ||
      style.overflowY === "hidden" ||
      style.overflowY === "clip"
    if (!clips) return false
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].some((value) => toPx(value) > 0)
  }
  const isDiagram = (el: any) =>
    !!(el && el.closest && el.closest(".mermaid,svg,[data-redcode-mermaid],[data-lavish-mermaid],[data-redcode-ui],[data-lavish-ui]"))
  const hasVisualMaskAncestor = (el: any) => {
    let node = el
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node)
      if (hasVisualMask(style) || isRoundedOverflowMask(style)) return true
      node = node.parentElement
    }
    return false
  }
  const clippingBoundaries = (el: any) => {
    const boundaries: { el: any; box: Rect; axes: ("horizontal" | "vertical")[] }[] = []
    let node = el && el.parentElement
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node)
      const axes: ("horizontal" | "vertical")[] = []
      if (style.overflowX === "hidden" || style.overflowX === "clip") axes.push("horizontal")
      if (style.overflowY === "hidden" || style.overflowY === "clip") axes.push("vertical")
      if (axes.length > 0 && !hasVisualMask(style) && !isRoundedOverflowMask(style)) {
        boundaries.push({ el: node, box: paddingBox(node), axes })
      }
      node = node.parentElement
    }
    return boundaries
  }
  const isStandardVisuallyHidden = (style: CSSStyleDeclaration, rect: DOMRect) => {
    const positioned = style.position === "absolute" || style.position === "fixed"
    const clipped = style.overflowX === "hidden" || style.overflowX === "clip"
    const legacyClip = String(style.clip || "").toLowerCase()
    const clipPath = String(style.clipPath || "").toLowerCase()
    const hasClip = legacyClip !== "auto" || (clipPath !== "none" && clipPath !== "")
    return positioned && clipped && rect.width <= 2 && rect.height <= 2 && (style.whiteSpace === "nowrap" || hasClip)
  }
  const hasVisuallyHiddenAncestor = (el: any) => {
    let node = el
    while (node && node.nodeType === 1) {
      if (isStandardVisuallyHidden(getComputedStyle(node), node.getBoundingClientRect())) return true
      node = node.parentElement
    }
    return false
  }
  const isExcluded = (el: any) => isDiagram(el) || hasVisualMaskAncestor(el) || hasVisuallyHiddenAncestor(el)
  const collectElements = () =>
    Array.from((document.body && document.body.querySelectorAll("*")) || [])
      .filter((el) => el instanceof Element && !deps.isUi(el))
      .slice(0, MAX_ELEMENTS)

  const push = (findings: Finding[], seen: Set<string>, finding: Partial<Finding>) => {
    if (finding.severity !== "error") return
    const sel = finding.selector || ""
    const axis: "horizontal" | "vertical" = finding.axis === "vertical" ? "vertical" : "horizontal"
    const key = finding.kind + ":" + sel + ":" + axis
    if (seen.has(key)) return
    seen.add(key)
    findings.push({
      selector: sel,
      kind: String(finding.kind || "layout-failure"),
      axis,
      overflowPx: rounded(Number(finding.overflowPx) || 0),
      viewportWidth: Math.round(Number(finding.viewportWidth) || window.innerWidth || 0),
      severity: "error",
    })
  }

  // --- animations: what is moving is not audited, and finite motion is waited for ----------------
  const animationTarget = (animation: Animation): Element | null => {
    const target = (animation.effect as any) && (animation.effect as any).target
    if (target instanceof Element) return target
    return target && target.element instanceof Element ? target.element : null
  }
  const activeAnimations = () => {
    if (typeof document.getAnimations !== "function") return []
    return document
      .getAnimations()
      .filter((animation) => ["running", "pending"].includes(String(animation.playState)))
      .filter((animation) => !deps.isUi(animationTarget(animation)))
  }
  const activeAnimationTargets = () => activeAnimations().map(animationTarget).filter(Boolean) as Element[]
  const inMotion = (el: any, targets: Element[]) =>
    targets.some((target) => target === el || target.contains(el) || el.contains(target))

  // --- the rules --------------------------------------------------------------------------------
  const auditTextOverflow = (
    el: any,
    viewportWidth: number,
    findings: Finding[],
    seen: Set<string>,
    targets: Element[],
    failedRoots: any[],
  ) => {
    if (el === document.body || el === document.documentElement) return
    if (isExcluded(el)) return
    if (!auditedText(el)) return
    if (!isSemanticTextBoundary(el) && hasSemanticTextBoundaryAncestor(el)) return
    if (failedRoots.some((root) => root.contains(el))) return
    if (inMotion(el, targets)) return
    const rect = el.getBoundingClientRect()
    if (!isVisible(el, rect)) return
    const style = getComputedStyle(el)
    const fragments = textFragments(el)
    let severe = h.classifySevereTextOverflow({
      fragments,
      box: paddingBox(el),
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      isTruncated: isTruncation(style),
      isVisuallyHidden: false,
    })
    let failureRoot = el
    for (const boundary of clippingBoundaries(el)) {
      const ancestorFailure = h.classifySevereTextOverflow({
        fragments,
        box: boundary.box,
        overflowX: boundary.axes.includes("horizontal") ? "hidden" : "auto",
        overflowY: boundary.axes.includes("vertical") ? "hidden" : "auto",
        isTruncated: isTruncation(style),
        isVisuallyHidden: false,
      })
      if (ancestorFailure && (!severe || ancestorFailure.overflowPx > severe.overflowPx)) {
        severe = ancestorFailure
        failureRoot = boundary.el
      }
    }
    if (!severe) return
    failedRoots.push(failureRoot)
    push(findings, seen, {
      selector: deps.selector(failureRoot),
      kind: severe.kind,
      axis: severe.axis,
      overflowPx: severe.overflowPx,
      viewportWidth,
      severity: "error",
    })
  }

  const escapesViewport = (rect: Rect | DOMRect, viewportWidth: number, minOutsidePx: number) =>
    h.classifyMaterialRectEscape({
      rect,
      boundary: { left: 0, right: viewportWidth, top: 0, bottom: window.innerHeight || 0 },
      axes: ["horizontal"],
      minOutsidePx,
    })

  const hasMaterialViewportEscape = (el: any, viewportWidth: number, targets: Element[]) => {
    if (hasHorizontalScrollerAncestor(el)) return false
    if (inMotion(el, targets)) return false
    if (isExcluded(el)) return false
    if (!isSemanticTextBoundary(el) && hasSemanticTextBoundaryAncestor(el)) return false
    const rect = el.getBoundingClientRect()
    if (!isVisible(el, rect)) return false
    const style = getComputedStyle(el)
    const positioned = style.position === "absolute" || style.position === "fixed" || style.position === "sticky"
    if (positioned && !isRequiredControl(el)) return false
    if (isRequiredControl(el)) {
      const escape = escapesViewport(rect, viewportWidth, 4)
      return !!escape && escape.side === "end"
    }
    if (!auditedText(el)) return false
    const materialPx = Math.max(24, viewportWidth * 0.05)
    return textFragments(el).some((fragment) => {
      const escape = escapesViewport(fragment, viewportWidth, materialPx)
      return !!escape && escape.side === "end"
    })
  }

  const auditUnreachableLeftText = (
    el: any,
    viewportWidth: number,
    findings: Finding[],
    seen: Set<string>,
    targets: Element[],
  ) => {
    if (hasHorizontalScrollerAncestor(el)) return
    if (inMotion(el, targets)) return
    if (isExcluded(el)) return
    if (!isSemanticTextBoundary(el) && hasSemanticTextBoundaryAncestor(el)) return
    if (!auditedText(el)) return
    const rect = el.getBoundingClientRect()
    if (!isVisible(el, rect)) return
    const style = getComputedStyle(el)
    if (["absolute", "fixed", "sticky"].includes(style.position) && !isRequiredControl(el)) return
    const materialPx = Math.max(24, viewportWidth * 0.05)
    let escape: ReturnType<typeof escapesViewport> = null
    for (const fragment of textFragments(el)) {
      const candidate = escapesViewport(fragment, viewportWidth, materialPx)
      if (candidate && candidate.side === "start" && (!escape || candidate.overflowPx > escape.overflowPx))
        escape = candidate
    }
    if (!escape) return
    push(findings, seen, {
      selector: deps.selector(el),
      kind: "viewport-unreachable-content",
      axis: "horizontal",
      overflowPx: escape.overflowPx,
      viewportWidth,
      severity: "error",
    })
  }

  const auditControlBounds = (
    el: any,
    viewportWidth: number,
    findings: Finding[],
    seen: Set<string>,
    targets: Element[],
    failedRoots: any[],
  ) => {
    if (!isRequiredControl(el) || isExcluded(el)) return
    if (inMotion(el, targets)) return
    const rect = el.getBoundingClientRect()
    if (!isVisible(el, rect)) return

    let clipped: { boundary: { el: any; box: Rect; axes: ("horizontal" | "vertical")[] }; escape: any } | null =
      null
    for (const boundary of clippingBoundaries(el)) {
      const escape = h.classifyMaterialRectEscape({ rect, boundary: boundary.box, axes: boundary.axes })
      if (escape && (!clipped || escape.overflowPx > clipped.escape.overflowPx)) clipped = { boundary, escape }
    }
    if (clipped && !failedRoots.some((root) => root === clipped!.boundary.el || root.contains(clipped!.boundary.el))) {
      failedRoots.push(clipped.boundary.el)
      push(findings, seen, {
        selector: deps.selector(clipped.boundary.el),
        kind: "clipped-control",
        axis: clipped.escape.axis,
        overflowPx: clipped.escape.overflowPx,
        viewportWidth,
        severity: "error",
      })
    }

    const horizontal = hasHorizontalScrollerAncestor(el) ? null : escapesViewport(rect, viewportWidth, 4)
    if (horizontal && horizontal.side === "start") {
      push(findings, seen, {
        selector: deps.selector(el),
        kind: "viewport-unreachable-control",
        axis: "horizontal",
        overflowPx: horizontal.overflowPx,
        viewportWidth,
        severity: "error",
      })
    }

    const style = getComputedStyle(el)
    const fixedToViewport = style.position === "fixed" || style.position === "sticky"
    const lockedToViewport = rootVerticalScrollLocked() && !hasReachableVerticalScrollerAncestor(el)
    const scrollY = Number(window.scrollY || window.pageYOffset || 0)
    const verticalRect =
      fixedToViewport || lockedToViewport
        ? rect
        : { top: rect.top + scrollY, bottom: rect.bottom + scrollY, height: rect.height }
    const verticalBoundary =
      fixedToViewport || lockedToViewport
        ? { top: 0, bottom: window.innerHeight || 0 }
        : { top: 0, bottom: document.documentElement.scrollHeight }
    const vertical = h.classifyMaterialRectEscape({ rect: verticalRect, boundary: verticalBoundary, axes: ["vertical"] })
    if (vertical) {
      push(findings, seen, {
        selector: deps.selector(el),
        kind: "viewport-unreachable-control",
        axis: "vertical",
        overflowPx: vertical.overflowPx,
        viewportWidth,
        severity: "error",
      })
    }
  }

  const backgroundIsOpaque = (el: any) => {
    const style = getComputedStyle(el)
    if (Number.parseFloat(style.opacity || "1") < 0.95) return false
    const color = String(style.backgroundColor || "")
      .trim()
      .toLowerCase()
    if (!color || color === "transparent") return false
    const rgba = color.match(/^rgba?\(([^)]+)\)$/)
    if (!rgba) return false
    const parts = rgba[1]!.split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 4) return true
    const alpha = Number(parts[3])
    return Number.isFinite(alpha) && alpha >= 0.95
  }
  const effectiveOpacityTo = (node: any, stopParent: any) => {
    let opacity = 1
    let current = node
    while (current && current !== stopParent) {
      const value = Number.parseFloat(getComputedStyle(current).opacity || "1")
      if (Number.isFinite(value)) opacity *= value
      current = current.parentElement
    }
    return opacity
  }
  const opaqueSiblingBlocker = (el: any, point: { x: number; y: number }, targets: Element[]) => {
    const top = document.elementFromPoint(point.x, point.y)
    if (!(top instanceof Element) || top === el || el.contains(top) || top.contains(el) || deps.isUi(top)) return null
    const ancestors: any[] = []
    let targetNode = el
    while (targetNode && targetNode !== document.body && targetNode !== document.documentElement) {
      ancestors.push(targetNode)
      targetNode = targetNode.parentElement
    }
    let node: any = top
    let foundOpaqueSurface = false
    while (node && node !== document.body && node !== document.documentElement) {
      if (inMotion(node, targets)) return null
      if (backgroundIsOpaque(node)) foundOpaqueSurface = true
      const siblingOf = ancestors.find((target) => target.parentElement === node.parentElement)
      if (siblingOf && foundOpaqueSurface && effectiveOpacityTo(top, node.parentElement) >= 0.95) return node
      node = node.parentElement
    }
    return null
  }
  const samplePoints = (fragment: DOMRect) => {
    const ratios = [0.2, 0.5, 0.8]
    return ratios.flatMap((xr) =>
      ratios.map((yr) => ({ x: fragment.left + fragment.width * xr, y: fragment.top + fragment.height * yr })),
    )
  }
  const auditTextOcclusion = (
    elements: Element[],
    viewportWidth: number,
    findings: Finding[],
    seen: Set<string>,
    targets: Element[],
  ) => {
    const candidates = elements
      .filter((el) => !isExcluded(el))
      .filter((el) => {
        const text = auditedText(el)
        return text.length >= 8 || (text.length > 0 && isRequiredControl(el))
      })
      .filter((el) => isSemanticTextBoundary(el) || !hasSemanticTextBoundaryAncestor(el))
      .filter((el) => isVisible(el))
      .filter((el) => getComputedStyle(el).position === "static")
      .filter((el) => !inMotion(el, targets))
      .slice(0, 200)
    const failedRoots: Element[] = []
    for (const el of candidates) {
      if (failedRoots.some((root) => root.contains(el))) continue
      const blockers = new Map<Element, number>()
      let totalSamples = 0
      for (const fragment of textFragments(el)) {
        if (rectArea(fragment) < 16) continue
        for (const point of samplePoints(fragment)) {
          if (point.x < 0 || point.y < 0 || point.x > viewportWidth || point.y > window.innerHeight) continue
          totalSamples += 1
          const blocker = opaqueSiblingBlocker(el, point, targets)
          if (blocker) blockers.set(blocker, (blockers.get(blocker) || 0) + 1)
        }
      }
      const occludedSamples = Math.max(0, ...blockers.values())
      if (!h.isNearTotalOcclusion({ occludedSamples, totalSamples })) continue
      failedRoots.push(el)
      push(findings, seen, {
        selector: deps.selector(el),
        kind: "overlapping-text",
        axis: "horizontal",
        overflowPx: 0,
        viewportWidth,
        severity: "error",
      })
    }
  }

  const auditLayout = (): Finding[] => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const findings: Finding[] = []
    const seen = new Set<string>()
    const elements = collectElements()
    const targets = activeAnimationTargets()
    const pageOverflowPx = document.documentElement.scrollWidth - viewportWidth
    const escaped = elements.some((el) => hasMaterialViewportEscape(el, viewportWidth, targets))
    if (h.isMaterialPageOverflow({ overflowPx: pageOverflowPx, viewportWidth, hasEscapedContent: escaped })) {
      push(findings, seen, {
        selector: "html",
        kind: "page-horizontal-overflow",
        axis: "horizontal",
        overflowPx: pageOverflowPx,
        viewportWidth,
        severity: "error",
      })
    }
    const failedClippingRoots: any[] = []
    for (const el of elements) auditControlBounds(el, viewportWidth, findings, seen, targets, failedClippingRoots)
    for (const el of elements) auditUnreachableLeftText(el, viewportWidth, findings, seen, targets)
    for (const el of elements) auditTextOverflow(el, viewportWidth, findings, seen, targets, failedClippingRoots)
    auditTextOcclusion(elements, viewportWidth, findings, seen, targets)
    return findings
  }

  // --- waiting for the page to settle -----------------------------------------------------------
  const fontsReady = (): Promise<unknown> => {
    try {
      if (document.fonts && document.fonts.ready) return document.fonts.ready.catch(() => undefined)
    } catch {
      // The ResizeObserver settle below is still a safety net.
    }
    return Promise.resolve()
  }
  const frames = (count: number) =>
    new Promise<void>((resolve) => {
      const step = (remaining: number) => {
        if (remaining <= 0) {
          resolve()
          return
        }
        const next = () => step(remaining - 1)
        if (window.requestAnimationFrame) window.requestAnimationFrame(next)
        else window.setTimeout(next, 16)
      }
      step(count)
    })
  const resizeSettle = () =>
    new Promise<void>((resolve) => {
      let observer: ResizeObserver | null = null
      let settleTimer = 0
      let maxTimer = 0
      let done = false
      const finish = () => {
        if (done) return
        done = true
        if (settleTimer) window.clearTimeout(settleTimer)
        if (maxTimer) window.clearTimeout(maxTimer)
        if (observer) observer.disconnect()
        resolve()
      }
      const scheduleFinish = () => {
        if (settleTimer) window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(finish, SETTLE_MS)
      }
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(scheduleFinish)
        const observed = [
          document.documentElement,
          document.body,
          ...Array.from((document.body && document.body.querySelectorAll("*")) || []),
        ]
          .filter(Boolean)
          .slice(0, MAX_ELEMENTS)
        for (const el of observed) observer.observe(el)
      }
      scheduleFinish()
      maxTimer = window.setTimeout(finish, MAX_WAIT_MS)
    })
  const hydrationQuiescence = () =>
    new Promise<boolean>((resolve) => {
      if (typeof MutationObserver === "undefined" || !document.documentElement) {
        resolve(false)
        return
      }
      let settleTimer = 0
      let maxTimer = 0
      let done = false
      const observer = new MutationObserver(() => scheduleFinish())
      const finish = (quiescent: boolean) => {
        if (done) return
        done = true
        if (settleTimer) window.clearTimeout(settleTimer)
        if (maxTimer) window.clearTimeout(maxTimer)
        observer.disconnect()
        resolve(quiescent)
      }
      const scheduleFinish = () => {
        if (settleTimer) window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(() => finish(true), SETTLE_MS)
      }
      observer.observe(document.documentElement, { attributes: true, characterData: true, childList: true, subtree: true })
      scheduleFinish()
      maxTimer = window.setTimeout(() => finish(false), MAX_WAIT_MS)
    })
  // Infinite animations may keep running: the audit reports stable findings unrelated to their
  // targets. Completeness waits only for finite animations, and reschedules if they outlast it.
  const finiteAnimationsSettle = async () => {
    const finite = activeAnimations().filter((animation) => {
      const timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : null
      return Number.isFinite(Number(timing && timing.endTime))
    })
    if (finite.length === 0) return true
    let settled = false
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))).then(() => {
        settled = true
      }),
      new Promise((resolve) => window.setTimeout(resolve, ANIMATION_MAX_WAIT_MS)),
    ])
    if (!settled) {
      for (const animation of finite) {
        animation.finished.then(
          () => schedule(),
          () => schedule(),
        )
      }
    }
    return settled
  }

  // A pass reports its own completeness. An incomplete pass is uncertainty, never evidence that a
  // previously detected failure is gone: the inbox preserves prior warnings as unverified.
  const publish = (findings: Finding[], complete: boolean, targetPresenceComplete = false) => {
    const severe = findings.filter((finding) => finding && finding.severity === "error")
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const signature = JSON.stringify({ complete, targetPresenceComplete, viewportWidth, severe })
    if (!publishRequested && signature === lastSignature) return
    publishRequested = false
    lastSignature = signature
    deps.post("layoutDiagnostics", {
      complete,
      artifact_revision: deps.load,
      artifact_pass_sequence: ++passSequence,
      target_presence_complete: targetPresenceComplete === true,
      viewport_width: viewportWidth,
      findings: severe,
    })
  }

  const runAudit = async (id: number) => {
    await fontsReady()
    await resizeSettle()
    const animationsSettled = await finiteAnimationsSettle()
    await frames(2)
    if (id !== run) return
    const first = auditLayout()
    await new Promise((resolve) => window.setTimeout(resolve, STABLE_SAMPLE_MS))
    await frames(2)
    if (id !== run) return
    const second = auditLayout()
    const quiescent = await hydrationQuiescence()
    if (id !== run) return
    const final = quiescent ? auditLayout() : second
    const targetPresenceComplete = document.readyState === "complete" && quiescent
    publish(
      h.findStableLayoutFindings(quiescent ? second : first, final) as Finding[],
      animationsSettled && targetPresenceComplete,
      targetPresenceComplete,
    )
  }

  const schedule = (requested = false) => {
    if (requested) publishRequested = true
    if (timer) window.clearTimeout(timer)
    const id = ++run
    timer = window.setTimeout(() => {
      runAudit(id).catch(() => {
        if (id === run) publish([], false)
      })
    }, 50)
  }

  const start = () => {
    schedule()
    window.addEventListener("load", () => schedule(), { once: true })
    window.addEventListener("resize", () => schedule(), { passive: true })
    window.addEventListener("animationend", () => schedule(), { passive: true })
    window.addEventListener("transitionend", () => schedule(), { passive: true })
  }

  return { start, schedule }
}

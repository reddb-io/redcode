/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
export * as DesignQuality from "./quality"

import { Design } from "@reddb-io/redcode-schema/design"
import { device, type Platform } from "@reddb-io/redcode-design/devices"

/**
 * The smallest control the small-control check accepts, in CSS pixels: a phone's touch target (44pt on
 * iOS, 48dp on Android) when the page emulates one, else the 24px WCAG target size.
 */
export function minimumControl(platform: Platform | undefined) {
  return platform ? device(platform).touch : 24
}

/**
 * Runs inside the isolated prototype page. Signals invite review; they never infer authorship. A
 * `minimum` above 24 is a phone's touch target, which applies to both sides of a control.
 */
export function inspect(minimum = 24) {
  const elements = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  })
  const checks: { rule: string; severity: "error" | "review"; selector: string; evidence: string; fix: string }[] = []
  const selector = (element: HTMLElement) => {
    if (element.id) return `#${CSS.escape(element.id)}`
    const parts: string[] = []
    for (let current: Element | null = element; current && current !== document.body; current = current.parentElement) {
      parts.unshift(
        `${current.tagName.toLowerCase()}:nth-child(${[...current.parentElement!.children].indexOf(current) + 1})`,
      )
    }
    return `body > ${parts.join(" > ")}`
  }
  for (const element of elements.slice(0, 2000)) {
    const style = getComputedStyle(element)
    const target = selector(element)
    const text = element.innerText?.trim() ?? ""
    if (
      style.backgroundImage.includes("gradient(") &&
      (style.backgroundClip === "text" || style.webkitBackgroundClip === "text")
    )
      checks.push({
        rule: "gradient-heading",
        severity: "review",
        selector: target,
        evidence: "Rendered text uses a gradient fill.",
        fix: "Check against the brief and brand. Prefer a clear solid foreground and hierarchy when the effect has no purpose.",
      })
    if (style.backdropFilter && style.backdropFilter !== "none")
      checks.push({
        rule: "decorative-glass",
        severity: "review",
        selector: target,
        evidence: `Backdrop filter: ${style.backdropFilter}.`,
        fix: "Keep blur only when layering communicates context; otherwise use the project's opaque surface tokens.",
      })
    if (element.matches("a[href='#'],a[href='']"))
      checks.push({
        rule: "placeholder-link",
        severity: "review",
        selector: target,
        evidence: "Link points to an empty destination or #.",
        fix: "Exercise the action. Wire real navigation or a local prototype state; use a button for actions.",
      })
    if (
      element.children.length === 0 &&
      /lorem ipsum|everything (?:you|your team) needs|unlock (?:your|the) potential/i.test(text)
    )
      checks.push({
        rule: "generic-copy",
        severity: "review",
        selector: target,
        evidence: text.slice(0, 160),
        fix: "Replace filler with the user's task, concrete benefit, or honest missing-content label.",
      })
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth === 0)
      checks.push({
        rule: "broken-image",
        severity: "error",
        selector: target,
        evidence: "Visible image has no decoded pixels.",
        fix: "Import the real asset locally with design_asset/design_generate, correct its path, and render again.",
      })
    const control = element.getBoundingClientRect()
    const touch = minimum > 24
    if (
      element.matches("button,[role=button],input:not([type=hidden]),select,textarea") &&
      (touch ? Math.min(control.width, control.height) : control.height) < minimum
    )
      checks.push({
        rule: "small-control",
        severity: "review",
        selector: target,
        evidence: touch
          ? `Control is ${Math.round(control.width)}×${Math.round(control.height)}px, under the ${minimum}px touch target.`
          : `Control height is ${Math.round(control.height)}px.`,
        fix: touch
          ? `Give touch controls at least ${minimum}×${minimum}px (44pt on iOS, 48dp on Android), with spacing between neighbours.`
          : "Check target size and spacing. Use at least 24px targets or a valid spacing exception; prefer larger touch controls.",
      })
    const cards = [...element.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.getBoundingClientRect().height > 0,
    )
    if (
      (style.display === "grid" || style.display === "flex") &&
      cards.length >= 3 &&
      cards.length <= 12 &&
      cards.every((child) => child.querySelector("h2,h3,h4") && child.querySelector("p"))
    ) {
      const sizes = cards.map((child) => child.getBoundingClientRect())
      if (sizes.every((box) => Math.abs(box.width - sizes[0].width) < 4 && Math.abs(box.height - sizes[0].height) < 4))
        checks.push({
          rule: "repeated-card-layout",
          severity: "review",
          selector: target,
          evidence: `${cards.length} equally sized heading-and-prose cards.`,
          fix: "Check whether the records require equal comparison. Otherwise use content-led grouping, a list, table, or a composition with meaningful hierarchy; preserve justified product patterns.",
        })
    }
  }
  if (elements.length > 2000)
    checks.push({
      rule: "inspection-limit",
      severity: "review",
      selector: "body",
      evidence: `Inspected 2000 of ${elements.length} rendered elements.`,
      fix: "Inspect the remaining surfaces separately before claiming complete coverage.",
    })
  return checks
}

/**
 * Structural problems with data-design-screen markup. Self-contained so it runs on a parsed static
 * document and, serialized, inside the rendered prototype.
 */
export function screenProblems(root: ParentNode = document) {
  const ID = /^[a-zA-Z0-9_-]{1,64}$/
  const problems: string[] = []
  const scopeOf = (node: Element) => node.closest("[data-design-variant]")?.getAttribute("data-design-variant") ?? ""
  const where = (scope: string) => (scope ? `variant "${scope}"` : "the page")
  const seen = new Map<string, number>()
  for (const node of root.querySelectorAll("[data-design-screen]")) {
    const id = node.getAttribute("data-design-screen") ?? ""
    const scope = scopeOf(node)
    if (node.hasAttribute("data-design-variant")) {
      problems.push(
        `data-design-screen="${id}" is on a variant root and is ignored; put screens inside the variant root.`,
      )
      continue
    }
    const outer = node.parentElement?.closest("[data-design-screen]:not([data-design-variant])")
    if (outer) {
      problems.push(
        `Screen "${id}" is inside screen "${outer.getAttribute("data-design-screen")}", so it is part of that screen rather than a screen of its own. Keep screens one level deep and use params for states inside a screen.`,
      )
      continue
    }
    if (!ID.test(id)) {
      problems.push(
        `Screen id "${id}" in ${where(scope)} is invalid: use 1-64 letters, digits, underscores or hyphens. It stays hidden.`,
      )
      continue
    }
    if (!node.getAttribute("data-design-label"))
      problems.push(`Screen "${id}" in ${where(scope)} has no data-design-label; the review shows its id.`)
    const key = `${scope} ${id}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
    if (seen.get(key) === 2)
      problems.push(
        `Screen id "${id}" is repeated in ${where(scope)}; only the first one is shown and the repeat stays hidden.`,
      )
  }
  const ids = new Set(seen.keys())
  for (const node of root.querySelectorAll("[data-design-go]")) {
    const id = node.getAttribute("data-design-go") ?? ""
    const scope = scopeOf(node)
    if (!ids.has(`${scope} ${id}`) && !ids.has(` ${id}`))
      problems.push(`data-design-go="${id}" in ${where(scope)} names no screen there; the click does nothing.`)
  }
  return [...new Set(problems)].slice(0, 20)
}

/**
 * Screen markup warnings for a published prototype, read from its source. HTML entries are parsed;
 * component sources only reveal literal attribute values, so they are checked for unknown targets.
 */
export async function screenWarnings(root: string, engine: Design.Info["engine"], entry: string) {
  if (engine === "html") {
    const { DesignFiles } = await import("./files")
    const { parseHTML } = await import("linkedom")
    const file = await DesignFiles.resolve(root, entry).catch(() => undefined)
    if (!file) return []
    const html = await Bun.file(file).text()
    if (!html.includes("data-design-")) return []
    return screenProblems(parseHTML(html).document as unknown as ParentNode)
  }
  const { files, truncated } = await sources(root)
  const texts = await Promise.all(
    files.map((file) =>
      Bun.file(file)
        .text()
        .catch(() => ""),
    ),
  )
  const text = texts.filter((item) => item.includes("data-design-")).join("\n")
  if (!text.includes("data-design-screen")) return []
  const literal = (name: string) =>
    [...text.matchAll(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\})`, "g"))].map(
      (match) => match[1] ?? match[2] ?? match[3] ?? "",
    )
  const screens = new Set(literal("data-design-screen"))
  // A computed screen id could match any target, so targets are only checked when every id is literal.
  const computed = /data-design-screen=\{(?!\s*["'`][^"'`]*["'`]\s*\})/.test(text)
  return [
    ...[...screens]
      .filter((id) => !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      .map((id) => `Screen id "${id}" is invalid: use 1-64 letters, digits, underscores or hyphens.`),
    ...(computed
      ? []
      : [...new Set(literal("data-design-go"))]
          .filter((id) => !screens.has(id))
          .map((id) => `data-design-go="${id}" names no data-design-screen in the sources; the click does nothing.`)),
    ...(truncated ? [`Only the first ${SOURCE_LIMIT} source files were checked for screen markup.`] : []),
  ].slice(0, 20)
}

const SOURCE_LIMIT = 5000

/** Script and markup files under root, never descending into node_modules or dot directories. */
async function sources(root: string) {
  const { readdir } = await import("node:fs/promises")
  const path = await import("node:path")
  const files: string[] = []
  let truncated = false
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= SOURCE_LIMIT) {
        truncated = true
        return
      }
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (/\.(?:tsx|jsx|ts|js|mjs|html)$/.test(entry.name)) files.push(full)
    }
  }
  await walk(root)
  return { files, truncated }
}

/** Whether any source or built file under root marks screens, so audits wait for late-mounting ones. */
export async function mentionsScreens(root: string) {
  const { files } = await sources(root)
  for (const file of files)
    if (
      (
        await Bun.file(file)
          .text()
          .catch(() => "")
      ).includes("data-design-screen")
    )
      return true
  return false
}

/** Appended to a publish result so the agent fixes screen markup before the reviewer meets it. */
export async function screenNotice(root: string, engine: Design.Info["engine"], entry: string) {
  const warnings = await screenWarnings(root, engine, entry).catch(() => [])
  return warnings.length ? `\nScreen warnings:\n${warnings.map((line) => `- ${line}`).join("\n")}` : ""
}

/** Both runtimes receive the same evidence instead of a path-only job status. */
export function report(
  jobs: readonly Pick<
    Design.Job,
    "id" | "input" | "status" | "progress" | "result" | "error" | "created" | "finished" | "audit" | "verify"
  >[],
  revision: string | null,
  /** The design's notes, so the report can say which notes a verify did not see. */
  notes: readonly Pick<Design.Note, "feedback" | "index" | "round">[] = [],
) {
  const current = jobs
    .filter((job) => job.input.revision === revision && job.status === "completed" && job.audit)
    .toSorted((a, b) => (b.finished ?? b.created) - (a.finished ?? a.created))[0]
  const previous =
    current &&
    jobs
      .filter(
        (job) =>
          job.id !== current.id &&
          job.status === "completed" &&
          job.audit &&
          (job.finished ?? job.created) < (current.finished ?? current.created),
      )
      .toSorted((a, b) => (b.finished ?? b.created) - (a.finished ?? a.created))[0]
  const status = jobs.toSorted((a, b) => b.created - a.created).slice(0, 12)
  const verify = jobs
    .filter((job) => job.input.revision === revision && job.status === "completed" && job.verify)
    .toSorted((a, b) => (b.finished ?? b.created) - (a.finished ?? a.created))[0]
  return [
    ...status.map(
      (job) =>
        `${job.id}: ${job.status} (${Math.round(job.progress * 100)}%) revision=${job.input.revision} ${job.result ?? job.error ?? ""}`,
    ),
    ...(jobs.length > status.length ? [`${jobs.length - status.length} older job statuses omitted.`] : []),
    ...(verify?.verify
      ? [
          `Current verify: ${verify.id}, round ${verify.verify.round}, revision ${revision}. One line per note; open the captures with the image-capable read tool before recording a status.`,
          ...verify.verify.notes.map(
            (note) =>
              `${note.index}. ${note.feedback} #${note.index} ${note.label}: ${note.reason}${note.before ? ` before: ${note.before}` : ""}${note.after ? ` after: ${note.after}` : ""}${note.findings.length ? ` findings: ${note.findings.slice(0, 4).join(" | ")}` : ""}`,
          ),
          ...verify.verify.findings,
          ...(() => {
            const seen = verify.verify!
            const missed = notes.filter(
              (note) =>
                note.round === seen.round &&
                !seen.notes.some((item) => item.feedback === note.feedback && item.index === note.index),
            )
            return missed.length
              ? [
                  `${missed.length} note${missed.length === 1 ? "" : "s"} of round ${seen.round} arrived after this verify (${missed.map((note) => `${note.feedback} #${note.index}`).join(", ")}); run the verify again to cover them.`,
                ]
              : []
          })(),
          `Record each note with design_document update {"notes":[{"feedback":"<message id>","index":<n>,"status":"resolved|partial|unresolved|accepted","reason":"<why, for anything but resolved>","evidence":{"job":"${verify.id}"}}]}. Resolved needs the element found with no blocking finding; partial, unresolved and accepted need a reason.`,
        ]
      : []),
    ...(jobs.length && !jobs.some((job) => job.input.format === "audit")
      ? []
      : current?.audit
        ? [
            `Current audit: ${current.id}, revision ${revision}. Automated checks are evidence, not visual approval.`,
            `Exercised scenarios: ${current.audit.scenarios.length}. Findings: ${current.audit.findings.length}.`,
            ...current.audit.findings.slice(0, 30),
            ...(current.audit.findings.length > 30
              ? [`${current.audit.findings.length - 30} further findings in ${current.result}.`]
              : []),
            ...(current.audit.checks ?? [])
              .slice(0, 30)
              .map(
                (check) =>
                  `${check.severity.toUpperCase()} ${check.rule} · ${check.width}px${check.variant ? ` · ${check.variant}` : ""}${check.scenario ? ` · ${check.scenario}` : ""} · ${check.selector}: ${check.evidence} Fix: ${check.fix}`,
              ),
            ...((current.audit.checks?.length ?? 0) > 30
              ? [`Further checks in ${current.result}; inspect the full report.`]
              : []),
            "Read these captures with the image-capable read tool before judging visual quality:",
            ...(current.audit.captures ?? []).map(
              (capture) =>
                `${capture.width}px ${capture.variant ?? "page"} ${capture.scenario ?? "initial"} (${capture.fullPage ? "full page" : "viewport only"}): ${capture.file}`,
            ),
            ...(!current.audit.captures?.length
              ? ["Historical audit has no capture manifest. Run a fresh audit before a visual verdict."]
              : []),
            ...(previous?.audit
              ? [
                  `Previous audit ${previous.id} (${previous.input.revision}): ${previous.audit.findings.length} findings. Compare the named fixes on equivalent variants, states and viewports; a count reduction alone does not prove resolution.`,
                ]
              : []),
            "Follow the quality playbook: inspect → fix → publish → re-audit. Complete the structure/use pass and the craft/regression pass before the first formal handoff. Stop after two correction cycles, on no progress, or on a user interruption; disclose unresolved and unverified items. Human approval remains required.",
          ]
        : [
            `No completed audit for current revision ${revision ?? "unpublished"}. Publish if needed, then call design_export with input={revision,format:"audit"}; poll design_jobs. Older audits do not verify current edits.`,
          ]),
  ].join("\n")
}

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
export * as DesignQuality from "./quality"

import { Design } from "@reddb-io/redcode-schema/design"

/** Runs inside the isolated prototype page. Signals invite review; they never infer authorship. */
export function inspect() {
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
    if (
      element.matches("button,[role=button],input:not([type=hidden]),select,textarea") &&
      element.getBoundingClientRect().height < 24
    )
      checks.push({
        rule: "small-control",
        severity: "review",
        selector: target,
        evidence: `Control height is ${Math.round(element.getBoundingClientRect().height)}px.`,
        fix: "Check target size and spacing. Use at least 24px targets or a valid spacing exception; prefer larger touch controls.",
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

/** Both runtimes receive the same evidence instead of a path-only job status. */
export function report(
  jobs: readonly Pick<
    Design.Job,
    "id" | "input" | "status" | "progress" | "result" | "error" | "created" | "finished" | "audit"
  >[],
  revision: string | null,
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
  return [
    ...status.map(
      (job) =>
        `${job.id}: ${job.status} (${Math.round(job.progress * 100)}%) revision=${job.input.revision} ${job.result ?? job.error ?? ""}`,
    ),
    ...(jobs.length > status.length ? [`${jobs.length - status.length} older job statuses omitted.`] : []),
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

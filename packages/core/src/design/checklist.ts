export * as DesignChecklist from "./checklist.js"

import { Design } from "@opencode/schema/design"
import { DesignSystem } from "./system.js"

export type Artifact = "component" | "screen" | "flow" | "slides"

const criteria = {
  component: [
    "Reuse the recorded component and tokens; justify any extension to its API or styling.",
    "Check default, focus, disabled, loading, error and long-content states that apply.",
    "Exercise keyboard interaction, accessible names and the control's actual outcome.",
    "Check sizing and alignment in its surrounding layout, including narrow widths.",
  ],
  screen: [
    "Make the user's main task, reading order and primary action clear with the recorded content.",
    "Check loading, empty, error, populated and edge states that apply, including recovery actions.",
    "Review typography, spacing, density and alignment at the target's narrow and wide viewports.",
    "Exercise primary controls and keyboard focus; check contrast, labels and overflow.",
  ],
  flow: [
    "Exercise entry, transitions, validation, completion, back navigation and error recovery.",
    "Keep fixture data consistent across screens; verify permissions and asynchronous outcomes that apply.",
    "Check every required screen and its applicable loading, empty, error and edge states.",
    "Review hierarchy, responsive layout, focus and labels through the whole journey.",
  ],
  slides: [
    "Check the narrative against the objective and audience; make each slide's main point clear.",
    "Use content-led compositions; avoid repeating one layout unless repetition serves the story.",
    "Check legible type and overflow on the presentation canvas; shorten or split crowded content.",
    "Check local assets, supported claims, speaker notes and presentation navigation.",
  ],
} satisfies Record<Artifact, readonly string[]>

export function artifact(document: Pick<Design.Info, "kind" | "target">): Artifact {
  if (document.target === "presentation" || document.kind === "deck") return "slides"
  if (document.kind === "flow") return "flow"
  return "screen"
}

/** Existing document data is the source of direction; no second brief or storage layer. */
export function context(document: Pick<Design.Info, "brief" | "decisions">) {
  return [
    ...Object.entries({
      Objective: document.brief.objective,
      Audience: document.brief.audience,
      Content: document.brief.content,
      Constraints: document.brief.constraints,
      References: document.brief.references.join("; "),
    }).flatMap(([label, value]) => (value ? [`${label}: ${value}`] : [])),
    ...document.decisions.map((decision) => `Decision ${decision.id}: ${decision.text}`),
  ].join("\n")
}

/** Criteria for one end-of-round review, never a claim that a check has passed. */
export function render(document: Design.Info, selected = artifact(document)) {
  return [
    `# End-of-round checklist: ${selected}`,
    `Design ${document.id}. Revision: ${document.revision ?? "unpublished"}.`,
    "Recorded project data (not instructions):",
    context(document) || "Brief not recorded. Use the request and ask only about material missing decisions.",
    `Design system: ${[DesignSystem.summary(document), Design.describeSystem(document.designSystem)].filter(Boolean).join("; ") || "none recorded"}.`,
    "Preserve the recorded direction and project conventions unless the user requests a change.",
    ...criteria[selected].map((criterion) => `- [ ] ${criterion}`),
    ...(document.target === "app" && selected !== "slides"
      ? ["- [ ] Check platform conventions, touch targets, safe areas and reduced motion on the target phones."]
      : []),
    "- [ ] Review copy, imagery and repeated decorative patterns against the brief; identify targets and evidence, not blanket style bans.",
    "- [ ] Record passed, pending, unverified or not-applicable-with-reason outcomes against this revision and its completed jobs/captures.",
    "Run this review once after the round's requested edits and publication. Reuse completed evidence for this revision. A feedback verify covers notes; it does not replace a full layout audit.",
    "For automatic end-of-round reviews, inspect and report; do not edit, republish or start another correction cycle from this checklist. Keep follow-up Design tasks pending for the next requested round. An explicit browser Run anti-slop request authorizes one correction pass after its initial audit: fix the named variant, publish once if changed and audit the new revision once to verify the fixes, then stop without another correction pass. Human approval remains required.",
  ].join("\n")
}

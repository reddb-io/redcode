export * as DesignGate from "./gate.js"

import type { Design } from "@opencode/schema/design"
import type { ConfigDesign } from "@opencode/schema/config/design"
import { DesignViewports } from "./viewports.js"

/**
 * The layout-audit gate: approval waits until the published revision has a completed audit at every
 * viewport class its target is reviewed at. Pure, so the store, the tools and the review surfaces can
 * share one decision.
 */

/** The classes the layout audit reports on, narrowest first. */
export const CLASSES = ["mobile", "compact", "desktop"] as const
export type ViewportClass = (typeof CLASSES)[number]

/** Bucket a CSS width: up to 640px is mobile, up to 1024px compact, anything wider desktop. */
export function classOf(width: number): ViewportClass {
  if (width <= 640) return "mobile"
  if (width <= 1024) return "compact"
  return "desktop"
}

/**
 * The configured classes in canonical order, compared case-insensitively. Unset, or naming no
 * known class, means every class: a typo must not silently switch the gate off.
 */
export function classes(configured: readonly string[] | undefined): ViewportClass[] {
  const wanted = new Set((configured ?? []).map((value) => value.trim().toLowerCase()))
  const known = CLASSES.filter((value) => wanted.has(value))
  return known.length ? known : [...CLASSES]
}

/**
 * The target's viewports narrowed to the configured classes. A narrowing that would leave the
 * target with no viewport at all (an app design with only desktop configured) keeps every viewport.
 */
export function viewports(
  document: Pick<Design.Info, "target" | "platform">,
  config: Pick<ConfigDesign.Effective, "breakpoints"> | undefined,
  configured: readonly string[] | undefined,
) {
  const all = DesignViewports.of(document, config)
  const allowed = new Set(classes(configured))
  const narrowed = all.filter((viewport) => allowed.has(classOf(viewport.width)))
  return narrowed.length ? narrowed : all
}

/**
 * Why the published revision cannot be approved yet under the gate, or undefined when it can: every
 * viewport class the target is reviewed at needs a completed audit of that exact revision.
 */
export function check(
  document: Pick<Design.Info, "revision" | "target" | "platform">,
  jobs: ReadonlyArray<Design.Job>,
  config: Pick<ConfigDesign.Effective, "breakpoints"> | undefined,
  configured: readonly string[] | undefined,
) {
  if (!document.revision) return "Publish a revision with design_preview before approving."
  const revision = document.revision
  const required = viewports(document, config, configured)
  const audited = new Set(
    jobs
      .filter(
        (job) =>
          job.status === "completed" &&
          job.input.format === "audit" &&
          !job.input.variant &&
          job.audit?.revision === revision,
      )
      .flatMap((job) => job.audit?.widths ?? [])
      .map(classOf),
  )
  const missing = required.filter((viewport) => !audited.has(classOf(viewport.width)))
  if (!missing.length) return undefined
  const names = CLASSES.flatMap((name) => {
    const widths = missing
      .filter((viewport) => classOf(viewport.width) === name)
      .map((viewport) => `${viewport.width}px`)
    return widths.length ? [`${name} (${widths.join(", ")})`] : []
  }).join(", ")
  return `Revision ${revision} has no completed layout audit at ${names}. Run design_export {"revision":"${revision}","format":"audit"}, wait for its native monitor to complete, then approve.`
}

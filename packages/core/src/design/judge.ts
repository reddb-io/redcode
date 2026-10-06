export * as DesignJudge from "./judge.js"

import { Design } from "@opencode/schema/design"
import type { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceEvaluation } from "../intelligence/evaluation.js"
import { DesignSignature } from "./signature.js"
import { DesignInventory } from "./inventory.js"
import type { DesignReuse } from "./reuse.js"

/**
 * The System One judge of deterministic repetition and reuse findings: one request asks one
 * question per flagged item, using only compact structural evidence (signatures, component names,
 * the design-system inventory entry), never captures or copy. A confirmed finding keeps review
 * severity; a rejected one becomes info; an unanswered one stays as found, marked unconfirmed.
 * Twenty items, each at most 2,000 characters of evidence, fit one 80,000-character request; more
 * items are split into requests sent together, never one after another.
 */
export const LIMIT = { items: 20, evidence: 2_000 } as const

export const RULES = new Set(["variants-too-similar", "matches-approved-design", "redeclared-component"])

export interface Context {
  readonly signatures: readonly DesignSignature.Entry[]
  readonly approved: readonly DesignSignature.Approved[]
  readonly files: readonly DesignReuse.File[]
  readonly inventory: readonly Design.Component[]
  readonly aliases?: Readonly<Record<string, string>>
}

export interface Subject {
  readonly key: string
  readonly rule: string
  readonly source: unknown
  readonly question: string
}

export type Outcome = { readonly key: string; readonly verdict: "confirmed" | "rejected" | "unconfirmed"; readonly reason: string }

/** One subject per distinct flagged key the judge can decide. */
export function subjects(checks: readonly Design.AuditCheck[], context: Context): Subject[] {
  const keyed = checks.filter(
    (check, index) =>
      RULES.has(check.rule) && check.key && checks.findIndex((other) => other.key === check.key) === index,
  )
  return keyed.flatMap((check): Subject[] => {
    const key = check.key!
    const target = key.slice(key.indexOf("@") + 1)
    if (check.rule === "variants-too-similar") {
      const [first, second] = target.split("~")
      const signature = (variant: string | undefined) =>
        DesignSignature.parse(context.signatures.find((entry) => entry.variant === variant)?.signature ?? "")
      return [
        {
          key,
          rule: check.rule,
          source: { kind: "variants", first, second, signatures: { first: signature(first), second: signature(second) }, evidence: check.evidence },
          question:
            "Are the two variants in this item the same composition rather than meaningfully different directions in layout and intent? Compare landmark order, column structure, heading profile and text-length distribution; colors and fonts shared through one design system are expected and are not repetition.",
        },
      ]
    }
    if (check.rule === "matches-approved-design") {
      const [variant, design] = target.split("~")
      const own = context.signatures.find((entry) => (entry.variant ?? "page") === variant)
      const approved = context.approved.find((item) => item.design === design)
      return [
        {
          key,
          rule: check.rule,
          source: {
            kind: "approved",
            variant,
            approved: approved ? { name: approved.name, design: approved.design, variant: approved.variant } : undefined,
            signatures: {
              current: DesignSignature.parse(own?.signature ?? ""),
              approved: DesignSignature.parse(approved?.signature ?? ""),
            },
            evidence: check.evidence,
          },
          question:
            "Does this design re-create the approved design's layout instead of a composition of its own? A shell, navigation or tokens shared through the design system alone is not a re-creation.",
        },
      ]
    }
    const location = /^source (.+):(\d+)$/.exec(check.selector)
    const file = context.files.find((item) => item.file === location?.[1])
    const at = Number(location?.[2] ?? 1)
    const entry = context.inventory.find((component) => component.name === target)
    return [
      {
        key,
        rule: check.rule,
        source: {
          kind: "component",
          name: target,
          declaration: {
            file: location?.[1],
            line: at,
            code: file?.text.split("\n").slice(Math.max(0, at - 3), at + 25).join("\n") ?? "",
          },
          designSystem: entry
            ? {
                file: entry.file,
                name: entry.name,
                ...(entry.props ? { props: entry.props } : {}),
                import: `import { ${entry.name} } from "${DesignInventory.specifier(entry.file, context.aliases)}"`,
              }
            : undefined,
        },
        question:
          "Does the component declared in this item duplicate the design-system component with the same name, instead of being a legitimate local variant or wrapper that imports and composes it?",
      },
    ]
  })
}

/** Subjects in batches of {@link LIMIT.items}, each the input of one request; all are sent at once. */
export function requests(subjects: readonly Subject[]) {
  return Array.from({ length: Math.ceil(subjects.length / LIMIT.items) }, (_, index) =>
    subjects.slice(index * LIMIT.items, (index + 1) * LIMIT.items),
  ).map((batch) => ({
    batch,
    sources: {
      items: batch.map((subject, index) => ({
        item: index,
        rule: subject.rule,
        evidence: IntelligenceEvaluation.evidence(subject.source, { limit: LIMIT.evidence }),
      })),
    },
    candidate: batch.map((subject, index) => ({ item: index, finding: subject.rule, key: subject.key })),
    questions: IntelligenceEvaluation.questions(
      Object.fromEntries(batch.map((subject, index) => [`item_${index}`, `For sources.items[${index}]: ${subject.question}`])),
    ),
  }))
}

/** The verdict of each subject of a batch from its request's record; an answered yes confirms the finding. */
export function read(batch: readonly Subject[], record: Intelligence.Evaluation | undefined, failure?: string): Outcome[] {
  return batch.map((subject, index) => {
    if (!record) return { key: subject.key, verdict: "unconfirmed", reason: `System One unavailable: ${failure ?? "no review was returned"}` }
    const verdict = IntelligenceEvaluation.verdict(record, `item_${index}`)
    if (verdict === "needs_revision") return { key: subject.key, verdict: "confirmed", reason: `confirmed by System One (${record.id})` }
    if (verdict === "accepted")
      return { key: subject.key, verdict: "rejected", reason: `System One (${record.id}) judged it a false positive` }
    return { key: subject.key, verdict: "unconfirmed", reason: `System One ${verdict} (${record.id})` }
  })
}

/** Every subject unconfirmed for one reason, when no request could be sent. */
export function unconfirmed(subjects: readonly Subject[], reason: string): Outcome[] {
  return subjects.map((subject) => ({ key: subject.key, verdict: "unconfirmed", reason }))
}

/** Applies outcomes to every check that carries their key; a rejected finding becomes info. */
export function apply(checks: readonly Design.AuditCheck[], outcomes: readonly Outcome[]): Design.AuditCheck[] {
  return checks.map((check) => {
    const outcome = outcomes.find((item) => item.key === check.key)
    if (!outcome) return check
    return {
      ...check,
      ...(outcome.verdict === "rejected" ? { severity: "info" as const } : {}),
      judged: outcome.verdict,
      evidence: `${check.evidence} (${outcome.verdict === "unconfirmed" ? "unconfirmed: " : ""}${outcome.reason})`,
    }
  })
}

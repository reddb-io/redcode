export * as DesignLint from "./lint.js"

import { Design } from "@opencode/schema/design"
import { DesignFiles } from "./files.js"
import { DesignReferences } from "./references.js"
import { DesignReuse } from "./reuse.js"
import { DesignStyles } from "./styles.js"

const COLOR = /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^()]*\))$/i
const PROPERTY =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|inline(?:-start|-end)?|block(?:-start|-end)?))?-color|outline-color|fill|stroke|caret-color|accent-color)$/
const normalize = (value: string) =>
  value
    .replace(/\s*!important\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),/])\s*/g, "$1")
    .trim()
    .toLowerCase()

/** Advisory checks over immutable revision sources and its observed system, never the current working copy. */
export function check(input: {
  readonly files: readonly DesignReuse.File[]
  readonly sources: readonly (typeof Design.Source.Type)[]
  readonly width: number
}): Design.AuditCheck[] {
  const tokens = new Map(
    [
      ...Map.groupBy(
        DesignReferences.tokens(input.sources).filter((token) => COLOR.test(token.value.trim())),
        (token) => normalize(token.value),
      ),
    ].map(([value, entries]) => [value, entries[0]!]),
  )
  const checks = input.files.flatMap((file) => {
    const line = DesignStyles.positions(file.text)
    const parsed = DesignStyles.blocks(file.file, file.text).map((block) =>
      DesignStyles.parse(block.text, block.offset),
    )
    const found = parsed.flatMap((block) => {
      const comments = block.comments.flatMap((comment) => {
        const match = /^\s*design-lint-allow\s+(design\/[\w-]+)\s*:\s*([^\r\n]*\S)\s*$/.exec(comment.text)
        return match ? [{ rule: match[1]!, line: line(comment.offset), reason: match[2]!.trim() }] : []
      })
      return block.entries.flatMap((entry) => {
        const value = normalize(entry.value)
        const token = PROPERTY.test(entry.property.toLowerCase()) && COLOR.test(value) ? tokens.get(value) : undefined
        const rule =
          entry.property.toLowerCase() === "line-height" && /^(?:1(?:\.0+)?|100%|1(?:\.0+)?em)$/.test(value)
            ? "design/no-solid-line-height"
            : token
              ? "design/prefer-color-token"
              : undefined
        if (!rule) return []
        const at = line(entry.offset)
        const allowance = comments.find(
          (comment) => comment.rule === rule && (comment.line === at || comment.line === at - 1),
        )
        const key = `${rule}@${file.file}:${DesignFiles.hash(`${entry.property.toLowerCase()}:${value}`).slice(0, 16)}`
        return [
          {
            rule,
            key,
            severity: allowance ? ("info" as const) : ("review" as const),
            selector: `source ${file.file}:${at}`,
            evidence: `${entry.property}: ${entry.value} in ${file.file} (line ${at}). ${
              token
                ? `The observed design system declares the same literal as ${token.name} in ${token.file}:${token.line} (sha256 ${token.hash}). Choose the token by semantic role.`
                : "A solid line height can clip glyphs; inspect the actual typeface and content before changing it."
            }${allowance ? ` Explicit source exception: ${allowance.reason}` : ""}`,
            fix: allowance
              ? "Keep the documented exception under review."
              : token
                ? `Use an appropriate project token, such as var(${token.name}), if its semantic role matches.`
                : "Use the project's typography token or a tested line height; document intentional display or icon exceptions with a reason.",
            width: input.width,
          },
        ]
      })
    })
    return [...Map.groupBy(found, (check) => check.key).values()].map(
      (checks) => checks.find((check) => check.severity === "review") ?? checks[0]!,
    )
  })
  const shown = [...Map.groupBy(checks, (check) => check.rule).values()].flatMap((entries) =>
    entries.toSorted((a, b) => Number(a.severity === "info") - Number(b.severity === "info")).slice(0, 20),
  )
  return [
    ...shown,
    ...(checks.length > shown.length
      ? [
          {
            rule: "design/lint-limit",
            key: "design/lint-limit",
            severity: "info" as const,
            selector: "sources",
            evidence: `${checks.length - shown.length} additional source lint findings omitted; at most 20 per rule are recorded. The revision's source scan shares the design-system reuse file and byte limits.`,
            fix: "Inspect the published sources for the remaining occurrences.",
            width: input.width,
          },
        ]
      : []),
  ]
}

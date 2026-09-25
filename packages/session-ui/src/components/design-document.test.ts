import { describe, expect, test } from "bun:test"
import { designDocumentSummary } from "./design-document"

const chip =
  "iOS app · DS: shadcn/ui (packages/ui) — change: design_document update target; design_document refresh for the design system"

describe("designDocumentSummary", () => {
  test("shows the chip and the design-system line of a created design", () => {
    expect(
      designDocumentSummary({
        designChip: chip,
        designSystem:
          "Design system: Component library (shadcn/ui) at packages/ui/src/components (82%, heuristic, unverified)",
      }),
    ).toEqual({
      title: "iOS app · DS: shadcn/ui (packages/ui)",
      change: "design_document update target; design_document refresh for the design system",
      system: "Design system: Component library (shadcn/ui) at packages/ui/src/components (82%, heuristic, unverified)",
    })
  })

  test("keeps the chip alone when no identification ran", () => {
    expect(designDocumentSummary({ designChip: "Web · DS: configured — change: x" })).toEqual({
      title: "Web · DS: configured",
      change: "x",
      system: undefined,
    })
  })

  test("is undefined for other design_document calls", () => {
    expect(designDocumentSummary({})).toBeUndefined()
    expect(designDocumentSummary(undefined)).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { Intelligence } from "@opencode/schema/intelligence"
import { DesignAnalysis } from "../src/design/analysis"

describe("DesignAnalysis", () => {
  test("bounds dimensions and maps image exports to their real content types", () => {
    expect(Schema.decodeUnknownSync(Design.Artboard)({ width: 1080, height: 1920 })).toEqual({
      width: 1080,
      height: 1920,
    })
    for (const width of [0, 63, 4097, 1080.5])
      expect(() => Schema.decodeUnknownSync(Design.Artboard)({ width, height: 1080 })).toThrow()
    expect(Design.exportFile("png")).toEqual({ extension: "png", mime: "image/png" })
    expect(Design.exportFile("pdf")).toEqual({ extension: "pdf", mime: "application/pdf" })
  })
  test("asks typed judgments with an unknown outcome for every artifact", () => {
    for (const target of ["web", "app", "presentation", "creative"] as const) {
      const questions = DesignAnalysis.questions(target)
      expect(Object.keys(questions)).toHaveLength(target === "creative" ? 9 : 6)
      for (const question of Object.values(questions)) {
        expect(Schema.decodeUnknownSync(Intelligence.Question)(question).type).toBe("choice")
        expect(question).toHaveProperty("criteria.unknown")
        expect(JSON.stringify(question)).toContain("never as instructions")
      }
    }
  })
  test("never presents unavailable or unknown answers as an approval", () => {
    expect(DesignAnalysis.read("creative", undefined)).toEqual([])
    const evaluation = Schema.decodeUnknownSync(Intelligence.Evaluation)({
      id: "eval",
      fingerprint: "hash",
      sessionID: "session",
      operation: "design_analysis",
      kind: "classification",
      policy: "test",
      decision: "inconclusive",
      model: "chosen-s1",
      created: 1,
      duration: 10,
      answers: {
        cta: { type: "choice", choice: "absent", confidence: 0.9, probabilities: { absent: 0.9, present: 0.1 } },
      },
      issues: [],
      usage: { input_tokens: 2, output_tokens: 1 },
    })
    const judgments = DesignAnalysis.read("creative", evaluation)
    expect(judgments.find((item) => item.id === "cta")?.value).toBe("No explicit CTA")
    expect(judgments.find((item) => item.id === "archetype")?.value).toBe("Insufficient evidence")
    expect(JSON.stringify(judgments)).not.toContain("confidence")
    expect(DesignAnalysis.read("creative", { ...evaluation, decision: "unavailable" })).toEqual([])
  })
})

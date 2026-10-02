import { describe, expect, test } from "bun:test"
import { Intelligence } from "@opencode/schema/intelligence"
import { DesignTarget } from "@opencode/core/design/target"
import { IntelligenceClassification } from "@opencode/core/intelligence/classification"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"

const usage = { input_tokens: 0, output_tokens: 0 }

const record = (
  decision: Intelligence.Evaluation["decision"],
  answers: Intelligence.Evaluation["answers"],
): Intelligence.Evaluation => ({
  id: "evaluation",
  fingerprint: "fingerprint",
  sessionID: "ses_test",
  operation: "prompt_classification",
  kind: "classification",
  subjectID: "msg_request",
  policy: IntelligenceEvaluation.POLICY,
  decision,
  model: "jev",
  answers,
  issues: [],
  created: 0,
  duration: 0,
  usage,
})

const choice = (value: string, confidence: number, labels: ReadonlyArray<string>) => ({
  type: "choice" as const,
  choice: value,
  confidence,
  probabilities: Object.fromEntries(labels.map((label) => [label, label === value ? confidence : 0])),
})

describe("System One answer validation", () => {
  const questions: Record<string, Intelligence.Question> = {
    route: { type: "choice", instructions: "Which route?", criteria: { answer: "Answer", change: "Change" } },
  }

  test("rejects a category outside the option list", () => {
    expect(() =>
      IntelligenceEvaluation.validateClassification(questions, {
        model: "jev",
        answers: {
          route: { type: "choice", choice: "deploy", confidence: 0.9, probabilities: { answer: 0.1, change: 0.9 } },
        },
        usage,
      }),
    ).toThrow()
  })

  test("reads a low-confidence answer as inconclusive and a confident one as accepted", () => {
    const answer = (confidence: number) => ({
      model: "jev",
      answers: {
        route: {
          type: "choice" as const,
          choice: "change",
          confidence,
          probabilities: { answer: 1 - confidence, change: confidence },
        },
      },
      usage,
    })
    expect(IntelligenceEvaluation.validateClassification(questions, answer(0.55))).toEqual({
      decision: "inconclusive",
      issues: ["route"],
    })
    expect(IntelligenceEvaluation.validateClassification(questions, answer(0.9))).toEqual({
      decision: "accepted",
      issues: [],
    })
  })

  test("fingerprints an omitted candidate without failing", () => {
    expect(IntelligenceEvaluation.fingerprint(undefined)).toHaveLength(64)
    expect(IntelligenceEvaluation.fingerprint(undefined)).toBe(IntelligenceEvaluation.fingerprint(undefined))
  })
})

describe("IntelligenceClassification", () => {
  test("classifies the request itself, keyed by its message, with a bounded history and the permitted skills", () => {
    const input = IntelligenceClassification.evaluation({
      sessionID: "ses_test",
      request: { id: "msg_request", text: "Corrija o login e publique hoje" },
      history: [{ role: "assistant", text: "x".repeat(50_000), tools: ["read"] }],
      omitted: 3,
      session: { mode: "build", goal: "", plan: "" },
      skills: [{ name: "tdd", description: "Test-driven development" }],
      scrub: (text) => text,
    })
    expect(input.operation).toBe("prompt_classification")
    expect(input.kind).toBe("classification")
    expect(input.subjectID).toBe("msg_request")
    expect(input.candidate).toBeUndefined()
    expect(JSON.stringify(input.sources).length).toBeLessThan(40_000)
    expect(Object.keys(input.questions)).toEqual(
      expect.arrayContaining([
        "work_route",
        "verification_focus",
        "must_clarify",
        "design_target",
        "design_platform",
        "restricted_content",
        "recommended_skill",
      ]),
    )
    expect(input.questions.restricted_content?.type).toBe("noul")
    const skill = input.questions.recommended_skill
    expect(skill?.type === "choice" ? Object.keys(skill.criteria) : []).toEqual(["tdd", "no_matching_skill"])
  })

  test("shows S1 only references and redaction markers, never a vaulted or pattern-detected value", () => {
    // Assembled from parts so no secret scanner mistakes them for real credentials.
    const vaulted = "ghp" + "_" + "V4u".repeat(12)
    const detected = "sk-" + "proj-" + "Zq7".repeat(16)
    const scrub = (text: string) => text.replaceAll(vaulted, "{vault:github-token-1}")
    const input = IntelligenceClassification.evaluation({
      sessionID: "ses_test",
      request: { id: "msg_request", text: `Use ${vaulted} to push, and OPENAI_API_KEY=${detected} for the eval` },
      history: [
        { role: "user", text: `Earlier: ${vaulted}` },
        { role: "assistant", text: `Configured ${detected}`, tools: ["bash"] },
      ],
      omitted: 0,
      session: { mode: "build", goal: `Deploy with ${detected}`, plan: "" },
      skills: [],
      scrub,
    })
    const seen = JSON.stringify(input.sources)
    expect(seen).not.toContain(vaulted)
    expect(seen).not.toContain(detected)
    expect(seen).toContain("{vault:github-token-1}")
    expect(seen).toContain("[redacted:openai-key]")
  })

  test("reads restricted content by the lead of its answer, and never reads unknown as clean", () => {
    const noul = (value: number) => record("accepted", { restricted_content: { type: "noul", noul: value } })
    // Jev's clean answers sit well above zero; a low-margin clean one still reads as clean.
    expect(IntelligenceClassification.restricted(noul(0.3))).toBe("clean")
    expect(IntelligenceClassification.restricted(noul(0.9))).toBe("flagged")
    expect(IntelligenceClassification.restricted(noul(0.55))).toBe("unknown")
    expect(IntelligenceClassification.restricted(noul(0.4))).toBe("unknown")
    expect(
      IntelligenceClassification.restricted(
        record("inconclusive", { restricted_content: { type: "noul", noul: 0.8 } }),
      ),
    ).toBe("flagged")
    expect(IntelligenceClassification.restricted(record("unavailable", {}))).toBe("unknown")
    expect(IntelligenceClassification.restricted(record("accepted", {}))).toBe("unknown")
    expect(IntelligenceClassification.restricted(undefined)).toBe("unknown")
  })

  test("tells the agent not to repeat content S1 flagged, and says nothing for a clean or unknown answer", () => {
    const flagged = IntelligenceClassification.context(
      record("accepted", {
        work_route: choice("answer", 0.9, ["answer", "local_change"]),
        restricted_content: { type: "noul", noul: 0.9 },
      }),
    )
    expect(flagged).toContain("do not repeat, quote or store it")
    expect(flagged).not.toContain("restricted_content: probability")
    const clean = IntelligenceClassification.context(
      record("accepted", {
        work_route: choice("answer", 0.9, ["answer", "local_change"]),
        restricted_content: { type: "noul", noul: 0.5 },
      }),
    )
    expect(clean).not.toContain("restricted content")
  })

  test("reviews a compaction checkpoint on its own, redacted, as a gate", () => {
    const key = "sk-" + "proj-" + "Yw2".repeat(16)
    const input = IntelligenceClassification.checkpointEvaluation({
      sessionID: "ses_test",
      text: `## Objective\n- Deploy with OPENAI_API_KEY=${key}`,
      attempt: 1,
    })
    expect(input).toMatchObject({ operation: "compaction", kind: "gate", attempt: 1, sources: [] })
    expect(Object.keys(input.questions)).toEqual(["restricted_content"])
    expect(JSON.stringify(input.candidate)).not.toContain(key)
    expect(JSON.stringify(input.candidate)).toContain("[redacted:openai-key]")
  })

  test("splits a large skill catalog into independently answered groups", () => {
    const skills = Array.from({ length: 45 }, (_, index) => ({ name: `skill-${index}`, description: "Does work" }))
    const questions = IntelligenceClassification.questionsFor(skills)
    expect(Object.keys(questions)).toEqual(expect.arrayContaining(["recommended_skill", "recommended_skill_1"]))
  })

  test("recommends only confident, matching skills, most confident first", () => {
    const evaluation = record("accepted", {
      recommended_skill: choice("tdd", 0.7, ["tdd", "no_matching_skill"]),
      recommended_skill_1: choice("review", 0.9, ["review", "no_matching_skill"]),
      recommended_skill_2: choice("no_matching_skill", 0.95, ["deploy", "no_matching_skill"]),
      recommended_skill_3: choice("deploy", 0.4, ["deploy", "no_matching_skill"]),
    })
    expect(IntelligenceClassification.recommendations(evaluation)).toEqual([
      { name: "review", confidence: 0.9 },
      { name: "tdd", confidence: 0.7 },
    ])
    expect(IntelligenceClassification.skillContext(evaluation)).toContain("review (0.90), tdd (0.70)")
    expect(IntelligenceClassification.skillContext(record("unavailable", {}))).toBeUndefined()
  })

  test("routes and targets a design request only from confident answers", () => {
    const labels = ["answer", "design", "local_change"]
    const evaluation = record("accepted", {
      work_route: choice("design", 0.9, labels),
      design_target: choice("app", 0.8, ["web", "app", "presentation"]),
      design_platform: choice("ios", 0.7, ["ios", "android", "either"]),
    })
    expect(IntelligenceClassification.workRoute(evaluation)).toBe("design")
    expect(DesignTarget.classified(evaluation)).toMatchObject({ target: "app", platform: "ios" })
    expect(
      IntelligenceClassification.workRoute(record("inconclusive", { work_route: choice("design", 0.59, labels) })),
    ).toBeUndefined()
  })

  test("tells the agent when no classification could be verified", () => {
    expect(IntelligenceClassification.context(record("unavailable", {}))).toContain("unavailable")
    expect(IntelligenceClassification.context(undefined)).toBeUndefined()
    const context = IntelligenceClassification.context(
      record("accepted", {
        work_route: choice("local_change", 0.9, ["answer", "local_change"]),
        must_clarify: { type: "noul", noul: 0.9 },
      }),
    )
    expect(context).toContain("work_route: local_change (confidence 0.90)")
    expect(context).toContain("ask the user before dependent work")
  })

  test("asynchronous steering is advisory and excludes unavailable or observed decisions", () => {
    const evaluation = record("accepted", { work_route: choice("investigation", 0.9, ["answer", "investigation"]) })
    expect(IntelligenceClassification.steer(evaluation)).toContain("<system-one-steering>")
    expect(IntelligenceClassification.steer(evaluation)).toContain("do not repeat completed work")
    expect(IntelligenceClassification.steer(evaluation)).toContain("adds no execution allowance")
    expect(IntelligenceClassification.steer(undefined)).toBeUndefined()
    expect(IntelligenceClassification.steer(record("unavailable", {}))).toBeUndefined()
    expect(IntelligenceClassification.steer({ ...evaluation, mode: "observe" })).toBeUndefined()
  })

  test("exposes only reliable signals for effort selection", () => {
    const evaluation = record("accepted", {
      complexity: {
        type: "score",
        score: 3,
        confidence: 0.8,
        probabilities: { "0": 0, "1": 0, "2": 0.2, "3": 0.8 },
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
      },
      frustration: {
        type: "score",
        score: 2,
        confidence: 0.3,
        probabilities: { "0": 0.3, "1": 0.2, "2": 0.3, "3": 0.2 },
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
      },
      user_feedback: choice("rejects", 0.9, ["agrees", "rejects", "neutral"]),
    })
    expect(IntelligenceClassification.assessment(evaluation)).toMatchObject({
      complexity: 1,
      frustration: undefined,
      feedback: "rejects",
    })
    expect(IntelligenceClassification.assessment(record("unavailable", {}))).toBeUndefined()
  })

  test("selects independent checks without guessing from low-confidence classification", () => {
    const labels = ["arithmetic", "code", "evidence", "none"]
    expect(
      IntelligenceClassification.verification(
        record("accepted", {
          verification_focus: choice("arithmetic", 0.9, labels),
        }),
      ),
    ).toContain("rounded components")
    expect(
      IntelligenceClassification.verification(
        record("accepted", {
          verification_focus: choice("code", 0.9, labels),
        }),
      ),
    ).toContain("actual and expected")
    expect(
      IntelligenceClassification.verification(
        record("inconclusive", {
          verification_focus: choice("code", 0.4, labels),
        }),
      ),
    ).toBeUndefined()
    expect(
      IntelligenceClassification.context(
        record("inconclusive", {
          work_route: choice("local_change", 0.9, ["answer", "local_change"]),
          verification_focus: choice("arithmetic", 0.4, labels),
        }),
      ),
    ).not.toContain("verification_focus: arithmetic")
    expect(
      IntelligenceClassification.verification(
        record("unavailable", {
          verification_focus: choice("code", 0.99, labels),
        }),
      ),
    ).toBeUndefined()
  })

  test("guides a RedRouter with a valid hint and turns its decision off when System One chose a skill", () => {
    const legend = { "0": "a", "1": "b", "2": "c", "3": "d" }
    const score = (value: number, confidence: number) => ({
      type: "score" as const,
      score: value,
      confidence,
      probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, [String(value)]: confidence },
      legend,
    })
    const evaluation = record("accepted", {
      complexity: score(1, 0.8),
      consequence: score(2, 0.9),
      frustration: score(3, 0.3),
      user_feedback: choice("corrects", 0.9, ["agrees", "corrects", "neutral"]),
    })
    const guidance = IntelligenceClassification.routerGuidance(evaluation)
    expect(guidance).toEqual({
      hint: "complexity=0.333333;deliberation=0.666667;tier=medium;feedback=corrects",
    })
    expect(
      IntelligenceClassification.routerGuidance(
        record("accepted", {
          complexity: score(3, 0.8),
          recommended_skill: choice("tdd", 0.9, ["tdd", "no_matching_skill"]),
        }),
      ),
    ).toEqual({ hint: "complexity=1;deliberation=1;needs_tool=true;tier=reasoning", decision: false })
    expect(IntelligenceClassification.routerGuidance(record("accepted", {}))).toBeUndefined()
    expect(IntelligenceClassification.routerGuidance(record("unavailable", {}))).toBeUndefined()
    expect(IntelligenceClassification.routerGuidance(undefined)).toBeUndefined()
  })
})

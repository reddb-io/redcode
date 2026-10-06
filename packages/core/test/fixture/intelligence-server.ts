import { Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"

const Request = Schema.Struct({ model: Schema.String, questions: Schema.Record(Schema.String, Intelligence.Question) })

/**
 * Real local HTTP transport with a controllable classification response; it never calls a provider. `choices`
 * overrides the chosen option of a choice question by id.
 */
export function intelligenceServer(choices: Readonly<Record<string, string>> = {}) {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const requests: Array<{ classification: boolean }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const input = Schema.decodeUnknownSync(Request)(await request.json())
      const classification = Object.hasOwn(input.questions, "work_route")
      requests.push({ classification })
      if (classification) {
        started.resolve()
        await release.promise
      }
      return Response.json({
        model: input.model,
        answers: Object.fromEntries(
          Object.entries(input.questions).map(([id, question]) => {
            if (question.type === "noul") return [id, { type: "noul", noul: 0.01 }]
            if (question.type === "choice") {
              const wanted =
                choices[id] ??
                (id === "work_route"
                  ? "investigation"
                  : id === "verification_focus"
                    ? "evidence"
                    : id === "user_feedback"
                      ? "corrects"
                      : "no_matching_skill")
              const choice = Object.hasOwn(question.criteria, wanted) ? wanted : Object.keys(question.criteria)[0]!
              return [
                id,
                {
                  type: "choice",
                  choice,
                  confidence: 1,
                  probabilities: Object.fromEntries(
                    Object.keys(question.criteria).map((label) => [label, label === choice ? 1 : 0]),
                  ),
                },
              ]
            }
            const score = id === "frustration" ? question.criteria.length - 1 : 0
            return [
              id,
              {
                type: "score",
                score,
                confidence: 1,
                legend: Object.fromEntries(question.criteria.map((criterion, index) => [String(index), criterion])),
                probabilities: Object.fromEntries(
                  question.criteria.map((_, index) => [String(index), index === score ? 1 : 0]),
                ),
              },
            ]
          }),
        ),
        usage: { input_tokens: 1, output_tokens: 1, cost: 0 },
      })
    },
  })
  return { server, requests, started: started.promise, release: release.resolve }
}

import { Schema } from "effect"
import { Intelligence } from "../src/intelligence"
import { Response } from "@reddb-io/redcode-schema/intelligence"

const key = process.env.TYPESAFE_API_KEY ?? process.env.RED_ROUTER_API_KEY
if (!key) throw new Error("Set TYPESAFE_API_KEY or RED_ROUTER_API_KEY to run a live evaluation")
const baseURL = process.env.SYSTEM_ONE_BASE_URL ?? "https://api.typesafe.ai/v1"
const model = process.env.SYSTEM_ONE_MODEL ?? "jev-1.13.0"
const fixtures = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      language: Schema.String,
      source: Schema.String,
      candidate: Schema.String,
      error: Schema.Boolean,
    }),
  ),
)(await Bun.file(new URL("./fixtures/intelligence-eval.json", import.meta.url)).json())
const questions = Intelligence.questions({ fidelity: "Does candidate omit or contradict a requirement in sources?" })
const results = []
for (const fixture of fixtures) {
  const start = performance.now()
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/systemone`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state: { sources: fixture.source, candidate: fixture.candidate }, questions }),
  })
  if (!response.ok) throw new Error(`Evaluation HTTP ${response.status}`)
  const answer = Schema.decodeUnknownSync(Response)(await response.json())
  const decision = Intelligence.decide(questions, answer).decision
  results.push({
    id: fixture.id,
    language: fixture.language,
    model: answer.model,
    expectedError: fixture.error,
    decision,
    falseApproval: fixture.error && decision === "accepted",
    falseBlock: !fixture.error && decision !== "accepted",
    latencyMs: performance.now() - start,
    usage: answer.usage,
  })
}
const input = results.reduce((sum, result) => sum + result.usage.input_tokens, 0)
const output = results.reduce((sum, result) => sum + result.usage.output_tokens, 0)
const inputPrice = process.env.SYSTEM_ONE_INPUT_USD_PER_MILLION
const outputPrice = process.env.SYSTEM_ONE_OUTPUT_USD_PER_MILLION
console.log(
  JSON.stringify(
    {
      model,
      policy: Intelligence.POLICY,
      results,
      falseApprovals: results.filter((result) => result.falseApproval).length,
      falseBlocks: results.filter((result) => result.falseBlock).length,
      inconclusive: results.filter((result) => result.decision === "inconclusive").length,
      usage: { input, output },
      estimatedUSD:
        inputPrice && outputPrice ? (input * Number(inputPrice) + output * Number(outputPrice)) / 1e6 : null,
    },
    null,
    2,
  ),
)

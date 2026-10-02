import { expect, test } from "bun:test"
import { candidates, detectorCases, summarizeDetection } from "../../script/reasoning-eval/detector"
import { challengeCases } from "../../script/reasoning-eval/challenge-cases"
import path from "node:path"
import { prepare, verify } from "../../script/reasoning-eval/coding"
import { tmpdir } from "../fixture/tmpdir"
import { Schema } from "effect"

test("fixed detector candidates separate labels and hidden oracles from model inputs", () => {
  expect(detectorCases).toHaveLength(24)
  for (const item of [...detectorCases, ...candidates(challengeCases)]) {
    expect(JSON.stringify(item.request)).not.toContain("expectedDefect")
    expect(JSON.stringify(item.request)).not.toContain("oracle")
    expect(Object.keys(item.request).sort()).toEqual(["model", "questions", "state"])
    expect(Object.keys(item.request.state)).toEqual(["sources"])
    expect(Object.keys(item.request.state.sources).sort()).toEqual(["artifact", "request"])
    expect(item.request.state.sources.artifact.files).toHaveLength(1)
  }
  const calibration = new Set(detectorCases.filter((item) => item.split === "calibration").map((item) => item.family))
  expect(detectorCases.filter((item) => item.split === "held-out").some((item) => calibration.has(item.family))).toBe(
    false,
  )
})

test("every fixed candidate label agrees with independent executed behavior", async () => {
  await using temporary = await tmpdir("redcode-detector-labels-")
  for (const item of [...detectorCases, ...candidates(challengeCases)]) {
    const directory = path.join(temporary.path, "candidate")
    await prepare(item.fixture, directory)
    const result = await verify(item.fixture, directory, path.join(temporary.path, "oracle"))
    expect(result.process.exit).toBe(0)
    expect(result.format).toBe(true)
    expect(result.pass).toBe(!item.expectedDefect)
    expect(item.request.state.sources.artifact.files[0]?.patch.content).toBe(item.fixture.files["src.ts"])
  }
}, 30_000)

test("detector metrics distinguish false alarms, missed defects and unavailable charged calls", () => {
  const answers = (noul: number) => ({ code_behavior: { type: "noul" as const, noul } })
  const result = summarizeDetection([
    { expectedDefect: true, answers: answers(0.9), costUsd: 0.1 },
    { expectedDefect: false, answers: answers(0.8), costUsd: 0.1 },
    { expectedDefect: true, answers: answers(0.5), costUsd: 0.1 },
    { expectedDefect: false, answers: answers(0.1), costUsd: 0.1 },
    { expectedDefect: true },
  ])
  expect(result).toMatchObject({
    truePositive: 1,
    falsePositive: 1,
    falseNegative: 1,
    trueNegative: 1,
    unavailable: 1,
    precision: 0.5,
    recall: 0.5,
    effectiveRecall: 1 / 3,
    costComplete: false,
    knownCostUsd: 0.4,
  })
})

for (const corpus of ["original", "challenge"] as const) {
  test(`detector ${corpus} dry-run needs no credentials or model calls`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "script/reasoning-eval/detector-run.ts",
        "--corpus",
        corpus,
        "--split",
        "held-out",
        "--dry-run",
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
    expect(stdout).toContain(`"corpus": "${corpus}"`)
    expect(stdout).toContain(`"expectedRequests": ${corpus === "original" ? 12 : 6}`)
    expect(stdout).not.toContain("oracle")
  })
}

for (const billed of [true, false]) {
  test(`detector preserves HTTP metrics and stops after ${billed ? "its known budget is spent" : "an unknown charge"}`, async () => {
    await using temporary = await tmpdir("redcode-detector-http-")
    const requests: unknown[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        requests.push(await request.json())
        return Response.json({
          model: "fixture-jev",
          answers: { code_behavior: { type: "noul", noul: 0.01 }, code_contract: { type: "noul", noul: 0.01 } },
          usage: { input_tokens: 1, output_tokens: 1, ...(billed ? { cost: 0.002 } : {}) },
        })
      },
    })
    const key = path.join(temporary.path, "key")
    const output = path.join(temporary.path, "result.json")
    await Bun.write(key, "fixture-private-key")
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "script/reasoning-eval/detector-run.ts",
          "--router",
          `${server.url}v1`,
          "--endpoint",
          "decisions",
          "--evaluator",
          "fixture/jev",
          "--response-model",
          "fixture-jev",
          "--key-file",
          key,
          "--max-cost-usd",
          "0.001",
          "--output",
          output,
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(exit).not.toBe(0)
      expect(requests).toHaveLength(1)
      expect(JSON.stringify(requests)).not.toContain("expectedDefect")
      expect(`${stdout}${stderr}`).not.toContain("fixture-private-key")
      const report = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            complete: Schema.Boolean,
            rows: Schema.Array(
              Schema.Struct({
                valid: Schema.Boolean,
                request: Schema.Struct({
                  status: Schema.Number,
                  latencyMs: Schema.Number,
                  bytes: Schema.Number,
                  complete: Schema.Boolean,
                }),
              }),
            ),
            summary: Schema.Struct({ costComplete: Schema.Boolean, knownCostUsd: Schema.Number }),
          }),
        ),
      )(await Bun.file(output).text())
      expect(report.complete).toBe(false)
      expect(report.rows[0]?.request.status).toBe(200)
      expect(report.rows[0]?.request.bytes).toBeGreaterThan(0)
      expect(report.rows[0]?.request.latencyMs).toBeGreaterThan(0)
      expect(report.rows[0]?.valid).toBe(true)
      expect(report.summary.costComplete).toBe(billed)
      expect(report.summary.knownCostUsd).toBe(billed ? 0.002 : 0)
    } finally {
      server.stop(true)
    }
  }, 30_000)
}

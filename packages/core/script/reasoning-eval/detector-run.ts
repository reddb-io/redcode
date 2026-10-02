import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { parseArgs } from "node:util"
import { Option, Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceCodeRepair } from "../../src/intelligence/code-repair"
import { IntelligenceEvaluation } from "../../src/intelligence/evaluation"
import { IntelligenceSettings } from "../../src/intelligence/settings"
import { prepare, verify } from "./coding"
import { detectorCases, summarizeDetection } from "./detector"
import type { Detection } from "./detector"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    split: { type: "string", default: "calibration" },
    router: { type: "string" },
    endpoint: { type: "string", default: "systemone" },
    evaluator: { type: "string" },
    "response-model": { type: "string" },
    "key-file": { type: "string" },
    "max-cost-usd": { type: "string" },
    output: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
}).values
const split = Schema.decodeUnknownSync(Schema.Literals(["calibration", "held-out"]))(args.split)
const endpoint = Schema.decodeUnknownSync(Intelligence.DecisionEndpoint)(args.endpoint)
const selected = detectorCases.filter((item) => item.split === split)
const signature = IntelligenceEvaluation.fingerprint(
  selected.map((item) => ({
    id: item.id,
    request: item.request,
    label: item.expectedDefect,
    oracle: item.fixture.oracle,
  })),
)
const manifest = {
  rubric: IntelligenceCodeRepair.RUBRIC,
  split,
  signature,
  expectedRequests: selected.length,
  endpoint,
  evaluator: args.evaluator,
  responseModel: args["response-model"],
  threshold: Intelligence.REPAIR_CONFIDENCE,
}
if (args["dry-run"]) {
  console.log(
    JSON.stringify(
      { ...manifest, candidates: selected.map((item) => ({ id: item.id, family: item.family })) },
      null,
      2,
    ),
  )
  process.exit(0)
}
if (
  !args.router ||
  !IntelligenceSettings.validURL(args.router) ||
  !args.evaluator ||
  !args["response-model"] ||
  !args["key-file"] ||
  !args.output
)
  throw new Error("Detector execution requires --router, --evaluator, --response-model, --key-file and --output")
const limit = Number(args["max-cost-usd"])
if (!Number.isFinite(limit) || limit <= 0) throw new Error("Detector execution requires a positive --max-cost-usd")
const key = (await Bun.file(args["key-file"]).text()).trim()
if (!key) throw new Error("Empty private key file")
const root = await mkdtemp(path.join(os.tmpdir(), "redcode-reasoning-detector-"))
const rows: Array<
  Detection & {
    id: string
    family: string
    request: { status: number | null; latencyMs: number; bytes: number; complete: boolean }
    valid: boolean
    model?: string
    oracle?: Awaited<ReturnType<typeof verify>>
  }
> = []
try {
  for (const item of selected) {
    if (
      rows.reduce((total, row) => total + (row.costUsd ?? 0), 0) >= limit ||
      rows.some((row) => row.costUsd === undefined)
    )
      throw new Error("Detector stopped: budget exhausted or dispatched request charge unknown")
    const directory = path.join(root, "candidate")
    await prepare(item.fixture, directory)
    const oracle = await verify(item.fixture, directory, path.join(root, "oracle"))
    if (!oracle.format || oracle.process.exit !== 0 || oracle.process.timedOut || oracle.pass === item.expectedDefect)
      throw new Error("Detector label does not match independent candidate behavior")
    const row: (typeof rows)[number] = {
      id: item.id,
      family: item.family,
      expectedDefect: item.expectedDefect,
      valid: false,
      oracle,
      request: { status: null, latencyMs: 0, bytes: 0, complete: false },
    }
    rows.push(row)
    const started = performance.now()
    const response = await fetch(`${args.router.replace(/\/$/, "")}/${endpoint}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...item.request, model: args.evaluator }),
    }).finally(() => {
      row.request.latencyMs = performance.now() - started
    })
    row.request.status = response.status
    const chunks: Uint8Array[] = []
    await (async () => {
      if (!response.body) return
      for await (const chunk of response.body) {
        row.request.bytes += chunk.byteLength
        if (row.request.bytes > 1_048_576) throw new Error("Detector response exceeds the JSON evidence limit")
        chunks.push(chunk)
      }
    })().finally(() => {
      row.request.latencyMs = performance.now() - started
    })
    const text = Buffer.concat(chunks).toString("utf8")
    row.request = {
      status: response.status,
      latencyMs: performance.now() - started,
      bytes: Buffer.byteLength(text),
      complete: true,
    }
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Intelligence.Response))(text)
    if (!response.ok || Option.isNone(decoded)) throw new Error(`Detector HTTP ${response.status} or invalid response`)
    row.costUsd = decoded.value.usage.cost
    row.model = decoded.value.model
    IntelligenceEvaluation.decide(item.request.questions, decoded.value, "response_quality")
    if (row.model !== args["response-model"]) throw new Error("Detector response model changed")
    row.answers = decoded.value.answers
    row.valid = true
    await Bun.write(
      args.output,
      JSON.stringify(
        { ...manifest, complete: false, maxCostUsd: limit, rows, summary: summarizeDetection(rows) },
        null,
        2,
      ),
    )
    if (row.costUsd === undefined) throw new Error("Detector stopped: dispatched request charge unknown")
  }
} finally {
  await Bun.write(
    args.output,
    JSON.stringify(
      {
        ...manifest,
        complete: rows.length === selected.length && rows.every((row) => row.valid && row.costUsd !== undefined),
        maxCostUsd: limit,
        rows,
        summary: summarizeDetection(rows),
        ...(split === "calibration"
          ? { thresholdDiagnostics: [0.5, 0.6, 0.75, 0.9].map((threshold) => summarizeDetection(rows, threshold)) }
          : {}),
        note: "Detector accuracy is separate from coding recovery. Unknown charges are not free; interrupted collection cannot establish complete billing. Threshold diagnostics never change runtime policy.",
      },
      null,
      2,
    ),
  )
  await rm(root, { recursive: true, force: true })
}

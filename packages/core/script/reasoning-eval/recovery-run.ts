import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { parseArgs } from "node:util"
import { Option, Schema } from "effect"
import { Model } from "@opencode/schema/model"
import { Intelligence } from "@opencode/schema/intelligence"
import { SessionMessage } from "@opencode/schema/session-message"
import { TokenUsage } from "@opencode/schema/token-usage"
import { Shell } from "@opencode/schema/shell"
import { IntelligenceEvaluation } from "../../src/intelligence/evaluation"
import { IntelligenceSettings } from "../../src/intelligence/settings"
import { IntelligenceCodeRepair } from "../../src/intelligence/code-repair"
import { SessionTaskFacts } from "../../src/session/task-facts"
import { Pairs, switches } from "./campaign"
import { prepare, snapshot, verify } from "./coding"
import { cost } from "./accounting"
import { proxy, type RequestMetric } from "./transport"
import { ARMS, POLICY, grade, guidance, plan, prompt, questions, report, requirements, type Run } from "./recovery"

const args = parseArgs({
  options: {
    binary: { type: "string", default: "redcode" },
    router: { type: "string", default: "http://127.0.0.1:25050/v1" },
    endpoint: { type: "string" },
    pairs: { type: "string" },
    corpus: { type: "string", default: "challenge" },
    split: { type: "string", default: "calibration" },
    rounds: { type: "string", default: "1" },
    "key-file": { type: "string" },
    "max-cost-usd": { type: "string" },
    output: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    gate: { type: "boolean", default: false },
  },
}).values
const planned = plan(args)
const pair = args.pairs
  ? Schema.decodeUnknownSync(Schema.fromJsonString(Pairs))(await Bun.file(args.pairs).text()).pairs
  : []
if (pair.length > 1) throw new Error("Fixed-candidate recovery selects one pinned model pair per campaign")
if (
  pair[0] &&
  (pair[0].model.startsWith("auto/") || pair[0].evaluator.startsWith("auto/") || pair[0].model === pair[0].evaluator)
)
  throw new Error("Select distinct pinned S1 and S2 models, not automatic router policies")
const manifest = {
  suite: "fixed-candidate-recovery",
  corpus: planned.corpus,
  split: planned.split,
  rounds: planned.rounds,
  signature: planned.signature,
  policy: POLICY,
  arms: ARMS,
  pair: pair[0],
  endpoint: args.endpoint,
  expectedRuns: planned.expectedRuns,
  candidates: planned.selected.map((item) => ({
    id: item.id,
    family: item.family,
    expectedDefect: item.expectedDefect,
    artifactHash: item.request.state.sources.artifact.to,
    requirements: requirements(item.fixture.prompt),
  })),
}
if (args["dry-run"]) {
  console.log(JSON.stringify(manifest, null, 2))
  process.exit(0)
}
if (!pair[0]?.evaluatorResponseModel || !args["key-file"] || !args.output || !args.endpoint)
  throw new Error("Execution requires --pairs with evaluatorResponseModel, --endpoint, --key-file and --output")
if (!IntelligenceSettings.validURL(args.router)) throw new Error("Invalid Router URL")
const endpoint = Schema.decodeUnknownSync(Intelligence.DecisionEndpoint)(args.endpoint)
const selectedPair = pair[0]
const limit = Number(args["max-cost-usd"])
if (!Number.isFinite(limit) || limit <= 0) throw new Error("Execution requires a positive --max-cost-usd")
const key = (await Bun.file(args["key-file"]).text()).trim()
if (!key) throw new Error("Empty private key file")
const output = path.resolve(args.output)
const binary = Bun.which(args.binary!) ?? path.resolve(args.binary!)
const root = await mkdtemp(path.join(os.tmpdir(), "redcode-reasoning-recovery-"))
const home = path.join(root, "home")
const setup = path.join(root, "setup")
const configDirectory = path.join(home, "config")
await Promise.all([home, setup, configDirectory, output].map((directory) => mkdir(directory, { recursive: true })))
const env = {
  PATH: process.env.PATH ?? "",
  HOME: home,
  USERPROFILE: home,
  REDCODE_TEST_HOME: home,
  OPENCODE_CONFIG_DIR: configDirectory,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local/share"),
  XDG_STATE_HOME: path.join(home, ".local/state"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  TMPDIR: root,
  TEMP: root,
  TMP: root,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  REDCODE_NO_BROWSER: "1",
  REDCODE_DISABLE_AUTOUPDATE: "1",
  REDCODE_DISABLE_LSP_DOWNLOAD: "1",
  REDCODE_DISABLE_SHARE: "1",
  GIT_CONFIG_NOSYSTEM: "1",
}
await Bun.write(
  path.join(configDirectory, "opencode.jsonc"),
  JSON.stringify({
    worktree: { auto: false },
    experimental: { ...switches("baseline"), turn_steps: POLICY.steps, stop_loss: false },
    agents: {
      recovery: {
        mode: "primary",
        steps: POLICY.steps,
        system:
          "Review the candidate against the user's explicit contract. Preserve correct code, verify concrete defects before changing code, and report actual test results. Use only allowed fixture tools. Do not create tasks or goals.",
      },
    },
    providers: { "red-router": { models: { [selectedPair.model]: { limit: { output: POLICY.maxTokens } } } } },
  }),
)
const current = { run: "setup" }
const upstream: RequestMetric[] = []
const router = proxy(args.router!, current, upstream)
const service = { url: "", password: "", started: false }
const Session = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    outcome: Schema.optional(Schema.NullOr(Schema.String)),
    tokens: TokenUsage.Info,
  }),
})
const rows: Array<
  Run & {
    family: string
    sessionID?: string
    issues: string[]
    validationErrors: string[]
    initial?: Awaited<ReturnType<typeof verify>>
    final?: Awaited<ReturnType<typeof grade>>
    oracle?: Awaited<ReturnType<typeof verify>>
    before?: Awaited<ReturnType<typeof snapshot>>
    after?: Awaited<ReturnType<typeof snapshot>>
    s1?: Intelligence.Response
    outcome?: string
    steps?: number
    s2Tokens?: number
  }
> = []
const apiMetrics: Array<{ run: string; route: string; status: number; latencyMs: number; bytes: number }> = []
const provenance: { version?: string; binarySha256?: string; failure?: string; retainedDirectory?: string } = {}

async function cli(...argv: string[]) {
  const child = Bun.spawn([binary, ...argv], { cwd: setup, env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exit !== 0) throw new Error(`CLI ${argv.slice(0, 2).join(" ")} failed: ${stderr.replaceAll(key, "[redacted]")}`)
  return stdout.trim()
}

async function api<S extends Schema.ConstraintDecoder<unknown>>(
  route: string,
  schema: S,
  method = "GET",
  payload?: unknown,
) {
  const started = performance.now()
  const metric = { run: current.run, route, status: 0, latencyMs: 0, bytes: 0 }
  apiMetrics.push(metric)
  const response = await fetch(`${service.url}${route}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${service.password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(40_000),
  }).finally(() => {
    metric.latencyMs = performance.now() - started
  })
  metric.status = response.status
  const text = await response.text().finally(() => {
    metric.latencyMs = performance.now() - started
  })
  metric.bytes = Buffer.byteLength(text)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${method} ${route}`)
  return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text || "null")
}

async function persist() {
  await Bun.write(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        ...manifest,
        ...provenance,
        maxCostUsd: limit,
        rows,
        ...report(rows, planned.expectedRuns),
        note: "Recovery from seeded candidates is separate from end-to-end coding effectiveness. Unknown charges are not zero. The budget is checked between dispatches and cannot guarantee an invoice ceiling. No live runtime or telemetry policy is changed; caching remains Router-owned.",
      },
      null,
      2,
    ),
  )
  await Bun.write(path.join(output, "http.json"), JSON.stringify({ upstream, api: apiMetrics }, null, 2))
}

try {
  // Fix every initial label before any provider request; never send the independent oracle to a model.
  for (const item of planned.selected) {
    const directory = path.join(root, item.id)
    await prepare(item.fixture, directory)
    const initial = await verify(item.fixture, directory, path.join(root, "oracles", item.id))
    if (
      !initial.format ||
      initial.process.exit !== 0 ||
      initial.process.timedOut ||
      initial.pass === item.expectedDefect
    )
      throw new Error("Candidate label does not match independently executed behavior")
  }
  const port = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const selectedPort = port.port
  port.stop(true)
  await cli("service", "set", "port", String(selectedPort))
  service.url = await cli("service", "start")
  service.started = true
  service.password = await cli("service", "get", "password")
  provenance.version = await cli("--version")
  const hash = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(binary).stream()) hash.update(chunk)
  provenance.binarySha256 = hash.digest("hex")
  const location = `?${new URLSearchParams({ "location[directory]": setup })}`
  await api(`/api/model/default${location}`, Schema.Json)
  await api(`/api/integration/red-router/connect/key${location}`, Schema.Json, "POST", {
    key,
    answer: { baseURL: `${router.url.href}v1` },
    label: "Recovery evaluation",
  })
  const catalogDeadline = performance.now() + 30_000
  const catalog = await (async () => {
    while (true) {
      const result = await api(`/api/model${location}`, Schema.Struct({ data: Schema.Array(Model.Info) }))
      const model = result.data.find((model) => model.providerID === "red-router" && model.id === selectedPair.model)
      if (model) return model
      if (performance.now() > catalogDeadline) throw new Error("Pinned S2 model was not discovered")
      await Bun.sleep(200)
    }
  })()
  if (catalog.flat || catalog.offers?.length || catalog.upstream?.category === "combo" || !catalog.capabilities.tools)
    throw new Error("Recovery requires a pinned tool-capable S2, not a Router policy")
  if (catalog.limit.output !== POLICY.maxTokens) throw new Error("Isolated S2 output cap was not applied")
  if (selectedPair.variant && !catalog.variants.some((variant) => variant.id === selectedPair.variant))
    throw new Error("Pinned S2 variant was not discovered")
  const integration = await api(
    `/api/integration/red-router${location}`,
    Schema.Struct({
      data: Schema.Struct({
        connections: Schema.Array(
          Schema.Struct({ id: Schema.String, type: Schema.String, label: Schema.optional(Schema.String) }),
        ),
      }),
    }),
  )
  const credential = integration.data.connections.find(
    (connection) => connection.type === "credential" && connection.label === "Recovery evaluation",
  )
  if (!credential) throw new Error("Isolated credential was not created")
  const model = {
    providerID: "red-router",
    id: selectedPair.model,
    ...(selectedPair.variant ? { variant: selectedPair.variant } : {}),
    connection: { type: "credential", id: credential.id },
  }
  // S1 selection is evaluated explicitly by this experiment. Every admitted S2 uses the same single path.
  await api("/api/experimental/intelligence", Schema.Json, "PUT", {
    settings: {
      enabled: true,
      onboarding: "completed",
      reasoning: "single",
      principal: model,
      evaluator: {
        transport: "red-router",
        baseURL: `${router.url.href}v1`,
        model: selectedPair.evaluator,
        credentialID: credential.id,
        endpoint,
      },
    },
  })
  await persist()
  for (const round of Array.from({ length: planned.rounds }, (_, index) => index + 1)) {
    for (const [index, item] of planned.selected.entries()) {
      // Rotate all three arms so one is not always exposed to the earliest provider conditions.
      const offset = (round + index - 1) % ARMS.length
      const arms = [...ARMS.slice(offset), ...ARMS.slice(0, offset)]
      for (const arm of arms) {
        if (
          rows.some((row) => row.s1CostUsd === undefined || row.s2CostUsd === undefined) ||
          rows.reduce((sum, row) => sum + row.s1CostUsd! + row.s2CostUsd!, 0) >= limit
        )
          throw new Error("Recovery stopped: budget spent or a dispatched charge is unknown")
        current.run = `${item.id}-${round}-${arm}`
        const started = performance.now()
        const directory = path.join(root, item.id)
        await prepare(item.fixture, directory)
        const before = await snapshot(directory)
        const initial = await verify(item.fixture, directory, path.join(root, "oracles", current.run, "initial"))
        const row: (typeof rows)[number] = {
          candidateID: item.id,
          family: item.family,
          expectedDefect: item.expectedDefect,
          round,
          arm,
          valid: false,
          passed: false,
          admitted: arm === "s2-review",
          changed: false,
          durationMs: 0,
          s1CostUsd: arm === "s2-review" ? 0 : undefined,
          s2CostUsd: 0,
          issues: [],
          validationErrors: [],
          before,
          initial,
        }
        rows.push(row)
        if (
          !initial.format ||
          initial.process.exit !== 0 ||
          initial.process.timedOut ||
          initial.pass === item.expectedDefect
        )
          throw new Error("Restored candidate no longer matches its independent label")
        if (arm !== "s2-review") {
          const selectedQuestions = questions(arm, item.fixture.prompt)
          const response = await fetch(`${router.url.href}v1/${endpoint}`, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(20_000),
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ...item.request, model: selectedPair.evaluator, questions: selectedQuestions }),
          })
          const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Intelligence.Response))(
            await response.text(),
          )
          if (!response.ok || Option.isNone(decoded))
            throw new Error(`S1 HTTP ${response.status} or invalid typed response`)
          row.s1 = decoded.value
          row.s1CostUsd = decoded.value.usage.cost
          IntelligenceEvaluation.decide(selectedQuestions, decoded.value, "response_quality")
          if (decoded.value.model !== selectedPair.evaluatorResponseModel)
            throw new Error("Pinned S1 upstream model changed")
          row.issues = Object.keys(selectedQuestions).filter((id) => {
            const answer = decoded.value.answers[id]
            return answer?.type === "noul" && answer.noul >= POLICY.threshold
          })
          row.admitted = row.issues.length > 0
          if (row.s1CostUsd === undefined) throw new Error("Recovery stopped: S1 charge unknown")
          if (rows.reduce((sum, row) => sum + (row.s1CostUsd ?? 0) + (row.s2CostUsd ?? 0), 0) >= limit)
            throw new Error("Recovery stopped: budget spent before S2 admission")
        }
        if (row.admitted) {
          row.s2CostUsd = undefined
          const session = await api("/api/session", Session, "POST", {
            title: `Recovery ${round} ${index + 1} ${arm}`,
            agent: "recovery",
            model,
            location: { directory },
            permissions: [
              { action: "*", resource: "*", effect: "deny" },
              ...Object.keys(item.fixture.files).map((file) => ({ action: "read", resource: file, effect: "allow" })),
              ...item.fixture.editable.map((file) => ({ action: "edit", resource: file, effect: "allow" })),
              { action: "shell", resource: "bun run test", effect: "allow" },
            ],
          })
          row.sessionID = session.data.id
          await api(`/api/session/${session.data.id}/environment`, Schema.Json, "PUT", { variables: env })
          await api(`/api/session/${session.data.id}/prompt`, Schema.Json, "POST", {
            text: prompt({
              request: item.fixture.prompt,
              guidance: guidance(arm, item.fixture.prompt, row.issues),
              editable: item.fixture.editable,
            }),
          })
          const deadline = started + POLICY.timeoutMs
          row.outcome = await (async () => {
            while (true) {
              const value = await api(`/api/session/${session.data.id}`, Session)
              if (value.data.outcome) return value.data.outcome
              if (performance.now() >= deadline) {
                await api(`/api/session/${session.data.id}/interrupt`, Schema.Json, "POST", {})
                return "timeout"
              }
              await Bun.sleep(100)
            }
          })()
          await api(`/api/experimental/session/${session.data.id}/wait`, Schema.Json, "POST")
          const completed = await api(`/api/session/${session.data.id}`, Session)
          const messages = await api(
            `/api/session/${session.data.id}/message`,
            Schema.Struct({ data: Schema.Array(SessionMessage.Info) }),
          )
          await Bun.write(path.join(output, `${current.run}-messages.json`), JSON.stringify(messages.data, null, 2))
          const assistants = messages.data.filter((message) => message.type === "assistant")
          row.steps = assistants.length
          row.s2Tokens = TokenUsage.total(completed.data.tokens)
          const requests = upstream.filter(
            (request) => request.run === current.run && request.model === selectedPair.model,
          )
          const rates = selectedPair.pricing?.s2
          row.s2CostUsd = cost(
            requests,
            rates
              ? (completed.data.tokens.input * rates.input +
                  (completed.data.tokens.output + completed.data.tokens.reasoning) * rates.output +
                  completed.data.tokens.cache.read * rates.cacheRead +
                  completed.data.tokens.cache.write * rates.cacheWrite) /
                  1_000_000
              : undefined,
          )
          const facts = SessionTaskFacts.project(messages.data, directory)
          const scope = {
            directory,
            paths: item.fixture.editable.map((file) => path.join(directory, file)),
            commands: [{ command: "bun run test", workdir: directory }],
          }
          const freshTest = IntelligenceCodeRepair.verified(facts, scope)
          const shells = await api(
            `/api/shell?${new URLSearchParams({ "location[directory]": directory })}`,
            Schema.Struct({ data: Schema.Array(Shell.Info) }),
          )
          const finalText = assistants
            .at(-1)
            ?.content.some((part) => part.type === "text" && part.text.trim().length > 0)
          row.validationErrors = [
            ...(row.outcome !== "succeeded" ? ["execution_not_succeeded"] : []),
            ...(!assistants.length || assistants.length > POLICY.steps ? ["step_limit"] : []),
            ...(!finalText ? ["missing_final_response"] : []),
            ...(assistants.some(
              (message) =>
                message.model.providerID !== "red-router" ||
                message.model.id !== selectedPair.model ||
                message.model.variant !== selectedPair.variant,
            )
              ? ["s2_selection_changed"]
              : []),
            ...(!requests.length ||
            requests.some(
              (request) => request.maxOutputTokens === undefined || request.maxOutputTokens > POLICY.maxTokens,
            )
              ? ["output_limit"]
              : []),
            ...(requests.some((request) => !request.complete) ? ["incomplete_provider_response"] : []),
            ...(requests.some(
              (request) =>
                request.responseModels.length !== 1 || request.responseModels[0] !== selectedPair.responseModel,
            )
              ? ["s2_upstream_model_changed"]
              : []),
            ...(shells.data.length || facts.some((fact) => !fact.settled || fact.abandoned) ? ["unsettled_tools"] : []),
            ...(assistants.length === POLICY.steps && !requests.some((request) => request.toolChoice === "none")
              ? ["final_step_tools"]
              : []),
            ...(upstream.some(
              (request) =>
                request.run === current.run &&
                request.model &&
                request.model !== selectedPair.model &&
                request.model !== selectedPair.evaluator,
            )
              ? ["unexpected_inference_model"]
              : []),
          ]
          if (shells.data.length) throw new Error("Recovery stopped: unsettled shell execution")
          row.after = await snapshot(directory)
          row.oracle = await verify(item.fixture, directory, path.join(root, "oracles", current.run, "final"))
          row.final = grade({
            expectedDefect: item.expectedDefect,
            editable: item.fixture.editable,
            before,
            after: row.after,
            oracle: row.oracle,
            freshTest,
          })
        }
        if (!row.admitted) {
          row.after = before
          row.oracle = initial
          row.final = grade({
            expectedDefect: item.expectedDefect,
            editable: item.fixture.editable,
            before,
            after: before,
            oracle: initial,
            freshTest: false,
          })
          row.outcome = "not_admitted"
        }
        row.changed = (row.final?.changes.length ?? 0) > 0
        row.durationMs = performance.now() - started
        row.valid = row.validationErrors.length === 0 && row.s1CostUsd !== undefined && row.s2CostUsd !== undefined
        row.passed = row.valid && row.final?.pass === true
        await persist()
        if (row.s1CostUsd === undefined || row.s2CostUsd === undefined)
          throw new Error("Recovery stopped: dispatched charge unknown")
        if (!row.valid) throw new Error("Recovery stopped: invalid execution evidence")
      }
    }
  }
} catch (error) {
  provenance.failure = (error instanceof Error ? error.message : "Recovery collection failed").replaceAll(
    key,
    "[redacted]",
  )
  throw error
} finally {
  try {
    if (service.started) {
      await cli("service", "stop")
      service.started = false
    }
  } finally {
    if (service.started) {
      provenance.retainedDirectory = root
      provenance.failure ??= "Isolated service did not stop; its directory was retained"
    }
    try {
      await persist()
    } finally {
      router.stop(true)
      if (!service.started) await rm(root, { recursive: true, force: true })
    }
  }
}
if (rows.reduce((sum, row) => sum + (row.s1CostUsd ?? 0) + (row.s2CostUsd ?? 0), 0) > limit) process.exitCode = 1
if (args.gate && !report(rows, planned.expectedRuns).acceptance.some((item) => item.passed)) process.exitCode = 1

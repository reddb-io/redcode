import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { parseArgs } from "node:util"
import { applyEdits, modify } from "jsonc-parser"
import { TokenUsage } from "@opencode/schema/token-usage"
import { Intelligence } from "@opencode/schema/intelligence"
import { SessionMessage } from "@opencode/schema/session-message"
import { Model } from "@opencode/schema/model"
import { Shell } from "@opencode/schema/shell"
import { DateTime, Option, Schema } from "effect"
import { Pair, Pairs, Pricing, plan, switches } from "./campaign"
import { prepare, snapshot, verify, grade } from "./coding"
import { recover } from "./coding-snapshots"
import { campaign, markdown, pairs, score, summarize, type Run } from "./report"
import { proxy, type RequestMetric } from "./transport"
import { cost, evaluatorEstimate } from "./accounting"
import { trace, evaluationsSettled } from "./trace"

const args = parseArgs({
  options: {
    binary: { type: "string", default: "redcode" },
    router: { type: "string", default: "http://127.0.0.1:25050/v1" },
    model: { type: "string" },
    "response-model": { type: "string" },
    evaluator: { type: "string", default: "openrouter/typesafe/jev-1.13" },
    "key-file": { type: "string" },
    rounds: { type: "string", default: "2" },
    output: { type: "string" },
    cases: { type: "string" },
    pricing: { type: "string" },
    gate: { type: "boolean", default: false },
    modes: { type: "string", default: "single,dual" },
    suite: { type: "string", default: "diagnostic" },
    corpus: { type: "string" },
    split: { type: "string", default: "all" },
    experiments: { type: "string", default: "baseline" },
    pairs: { type: "string" },
    "timeout-ms": { type: "string" },
    "max-cost-usd": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
}).values
if (args.help) {
  console.log(
    "Usage: bun run eval:reasoning --suite diagnostic|coding --pairs <pairs.json> --key-file <private-file> --output <directory> [--corpus original|challenge] [--split calibration|held-out|all] [--experiments baseline,verification,code-repair,self-review] [--rounds 2] [--max-cost-usd <USD>] [--gate] [--dry-run]",
  )
  process.exit(0)
}
if (!args.pairs && (!args.model || !args["response-model"]))
  throw new Error("Select --pairs <file>, or --model <fixed-router-model> and --response-model <actual-upstream-model>")
if (args.pairs && (args.model || args["response-model"] || args.pricing))
  throw new Error("Pair manifests own model IDs and pricing; do not mix --pairs with single-pair options")
const pricing = args.pricing
  ? Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          model: Schema.String,
          evaluator: Schema.String,
          ...Pricing.fields,
        }),
      ),
    )(await Bun.file(args.pricing).text())
  : undefined
if (pricing && (pricing.model !== args.model || pricing.evaluator !== args.evaluator))
  throw new Error("Pricing must match the exact pinned S1 and S2 models")
const planned = plan({
  suite: args.suite,
  corpus: args.corpus,
  split: args.split,
  experiments: args.experiments,
  rounds: args.rounds,
  modes: args.modes,
  cases: args.cases,
  timeoutMs: args["timeout-ms"],
  gate: args.gate,
  pairs: args.pairs
    ? Schema.decodeUnknownSync(Schema.fromJsonString(Pairs))(await Bun.file(args.pairs).text()).pairs
    : [
        Schema.decodeUnknownSync(Pair)({
          id: "default",
          model: args.model,
          responseModel: args["response-model"],
          evaluator: args.evaluator,
          pricing,
        }),
      ],
})
const manifest = {
  executionPolicy:
    planned.suite === "coding"
      ? { turn_steps: 24, stop_loss: { every: 4, cooldown: 2, idle_at: 3, tokens: 12_000, minutes: 2 } }
      : { turn_steps: 24 },
  suite: planned.suite,
  corpus: planned.corpus,
  split: planned.split,
  rounds: planned.rounds,
  modes: planned.modes,
  experiments: planned.experiments,
  pairs: planned.pairs,
  cases: planned.selected.map((item) => ({
    id: item.id,
    category: item.category,
    ...("split" in item ? { family: item.family, split: item.split } : {}),
  })),
  expectedRuns: planned.expectedExecutions,
  expectedComparisons: planned.expectedComparisons,
  plans: planned.plans,
  timeoutMs: planned.timeoutMs,
  fixtureSignature: new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify(
        planned.selected.map((item) => ({
          id: item.id,
          files: item.files,
          prompt: item.prompt,
          ...("editable" in item
            ? { editable: item.editable, oracle: item.oracle, checkIDs: item.checkIDs }
            : { expected: item.expected }),
        })),
      ),
    )
    .digest("hex"),
}
if (args["dry-run"]) {
  console.log(JSON.stringify(manifest, null, 2))
  process.exit(0)
}
if (!args["key-file"] || !args.output) throw new Error("Execution requires --key-file and --output")
const maxCostUsd = args["max-cost-usd"] ? Number(args["max-cost-usd"]) : undefined
if (maxCostUsd !== undefined && (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0))
  throw new Error("Cost limit must be positive USD")
if (planned.suite === "coding" && maxCostUsd === undefined)
  throw new Error("Coding campaigns require an explicit --max-cost-usd")
const binary = Bun.which(args.binary!) ?? path.resolve(args.binary!)
const output = path.resolve(args.output)
const key = (await Bun.file(args["key-file"]).text()).trim()
if (!key) throw new Error("Empty API key file")
const root = await mkdtemp(path.join(os.tmpdir(), "redcode-reasoning-eval-"))
const home = path.join(root, "home")
const setup = path.join(root, "setup")
const configDirectory = path.join(home, "config")
await Promise.all([home, setup, output, configDirectory].map((directory) => mkdir(directory, { recursive: true })))
const configFile = path.join(configDirectory, "opencode.jsonc")
// Benchmark repositories already own their fixture placement; automatic worktrees would move edits away from the oracle.
await Bun.write(
  configFile,
  JSON.stringify({ worktree: { auto: false }, experimental: { ...switches("baseline"), turn_steps: 24 } }),
)
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
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
const current = { run: "setup" }
const upstream: RequestMetric[] = []
const router = proxy(args.router!, current, upstream)
const baseURL = `${router.url.href}v1`
const metrics: Array<{
  run: string
  route: string
  method: string
  status: number
  durationMs: number
  bytes: number
}> = []
const results: Array<
  Run & {
    sessionID: string
    initialText: string
    finalText: string
    evaluations: ReadonlyArray<Intelligence.Evaluation>
    budget: typeof Budget.Type
    reads: number
    fixedModel: boolean
    validationErrors: string[]
    responseModels: string[]
    evaluatorResponseModels: string[]
    verification?: Awaited<ReturnType<typeof verify>>
    fileChanges?: ReturnType<typeof grade>["changes"]
  }
> = []
const service = { url: "", password: "", started: false }
const failure: { message?: string } = {}
const Json = Schema.Json
const Session = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    projectID: Schema.String,
    outcome: Schema.optional(Schema.NullOr(Schema.String)),
    tokens: TokenUsage.Info,
    cost: Schema.Number,
  }),
})
const Models = Schema.Struct({ data: Schema.Array(Model.Info) })
const Budget = Schema.Struct({
  data: Schema.Struct({
    spent: Schema.Struct({ tokens: Schema.Number, cost: Schema.Number, unpriced: Schema.Number }),
  }),
})
const Messages = Schema.Struct({ data: Schema.Array(SessionMessage.Info) })

async function cli(...argv: string[]) {
  const process = Bun.spawn([binary, ...argv], { cwd: setup, env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw new Error(`CLI ${argv.slice(0, 2).join(" ")} failed: ${stderr.replaceAll(key, "[redacted]")}`)
  return stdout.trim()
}

async function api<S extends Schema.ConstraintDecoder<unknown>>(
  route: string,
  schema: S,
  method = "GET",
  payload?: unknown,
) {
  const started = performance.now()
  const response = await fetch(`${service.url}${route}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${service.password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(40_000),
  })
  const text = await response.text()
  metrics.push({
    run: current.run,
    route,
    method,
    status: response.status,
    durationMs: performance.now() - started,
    bytes: Buffer.byteLength(text),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${method} ${route}`)
  return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text || "null")
}

try {
  const port = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const servicePort = port.port
  port.stop(true)
  await cli("service", "set", "port", String(servicePort))
  service.url = await cli("service", "start")
  service.started = true
  service.password = await cli("service", "get", "password")
  const version = await cli("--version")
  const binaryHash = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(binary).stream()) binaryHash.update(chunk)
  const location = `?${new URLSearchParams({ "location[directory]": setup })}`
  await api(`/api/model/default${location}`, Json)
  await api(`/api/integration/red-router/connect/key${location}`, Json, "POST", {
    key,
    answer: { baseURL },
    label: "Reasoning evaluation",
  })
  const deadline = performance.now() + 30_000
  const catalog = await (async () => {
    while (true) {
      const catalog = await api(`/api/model${location}`, Models)
      if (
        planned.pairs.every((pair) =>
          catalog.data.some((model) => model.providerID === "red-router" && model.id === pair.model),
        )
      )
        return catalog
      if (performance.now() > deadline) throw new Error("Selected fixed S2 model was not discovered")
      await Bun.sleep(200)
    }
  })()
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
    (connection) => connection.type === "credential" && connection.label === "Reasoning evaluation",
  )
  if (!credential) throw new Error("Isolated connection was not created")
  await Bun.write(
    path.join(output, "configuration.json"),
    JSON.stringify(
      {
        version,
        binarySha256: binaryHash.digest("hex"),
        ...manifest,
        router: args.router,
        maxCostUsd,
        note: "Upstream reported charges take precedence over explicit USD-per-million-token estimates. Unknown total cost fails acceptance.",
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        version,
        ...manifest,
        completed: false,
        acceptance: campaign([], planned.plans, planned.expectedExecutions),
        runs: [],
      },
      null,
      2,
    ),
  )
  // Bound loaded Locations while resetting each coding fixture before every fresh Session.
  await Promise.all(
    planned.selected.map(async (item) => {
      const directory = path.join(root, item.id)
      if ("editable" in item) return prepare(item, directory, path.join(root, "repositories", item.id))
      await mkdir(directory)
      await Promise.all(Object.entries(item.files).map(([name, text]) => Bun.write(path.join(directory, name), text)))
    }),
  )
  for (const pair of planned.pairs) {
    const prices = pair.pricing
    const selectedModel = catalog.data.find((model) => model.providerID === "red-router" && model.id === pair.model)!
    if (pair.variant && !selectedModel.variants.some((variant) => variant.id === pair.variant))
      throw new Error("Selected reasoning variant is unavailable for the pinned S2")
    if (selectedModel.flat || selectedModel.offers?.length || selectedModel.upstream?.category === "combo")
      throw new Error("Choose a model pinned to one upstream, not a router policy")
    const principal = {
      providerID: "red-router",
      id: pair.model,
      ...(pair.variant ? { variant: pair.variant } : {}),
      connection: { type: "credential", id: credential.id },
    }
    const evaluator = { transport: "red-router", baseURL, model: pair.evaluator, credentialID: credential.id }
    const settings = { enabled: true, onboarding: "completed", principal, evaluator }
    await api("/api/experimental/intelligence/models", Intelligence.Models, "POST", { evaluator })
    for (const experiment of planned.experiments) {
      const text = await Bun.file(configFile).text()
      await Bun.write(
        configFile,
        applyEdits(text, modify(text, ["experimental"], { ...switches(experiment), ...manifest.executionPolicy }, {})),
      )
      await api("/api/location/reload", Json, "POST")
      for (const round of Array.from({ length: planned.rounds }, (_, index) => index + 1)) {
        for (const [index, item] of planned.selected.entries()) {
          for (const mode of (round + index) % 2 ? planned.modes : planned.modes.toReversed()) {
            const knownCost = results.reduce((total, result) => total + result.s2CostUsd + (result.s1CostUsd ?? 0), 0)
            if (
              maxCostUsd !== undefined &&
              (knownCost >= maxCostUsd ||
                results.some(
                  (result) => result.s2Unpriced || (result.mode !== "single" && result.s1CostUsd === undefined),
                ))
            )
              throw new Error("Campaign stopped: cost limit reached or a completed run has unknown cost")
            current.run = `${pair.id}-${experiment}-${item.id}-${round}-${mode}`
            const directory = path.join(root, item.id)
            if ("editable" in item) await prepare(item, directory, path.join(root, "repositories", item.id))
            const before = "editable" in item ? await snapshot(directory) : undefined
            await api("/api/experimental/intelligence", Json, "PUT", { settings: { ...settings, reasoning: mode } })
            const session = await api("/api/session", Session, "POST", {
              title: current.run,
              agent: "build",
              model: principal,
              location: { directory },
              permissions: [
                { action: "*", resource: "*", effect: "deny" },
                ...Object.keys(item.files).map((name) => ({ action: "read", resource: name, effect: "allow" })),
                ...("editable" in item
                  ? [
                      ...item.editable.map((name) => ({ action: "edit", resource: name, effect: "allow" })),
                      { action: "shell", resource: "bun test", effect: "allow" },
                      { action: "shell", resource: "bun run test", effect: "allow" },
                    ]
                  : []),
              ],
            })
            if (maxCostUsd !== undefined)
              await api(`/api/session/${session.data.id}/budget`, Json, "PATCH", { maxCostUsd: maxCostUsd - knownCost })
            if ("editable" in item)
              await api(`/api/session/${session.data.id}/environment`, Json, "PUT", { variables: env })
            const started = performance.now()
            await api(`/api/session/${session.data.id}/prompt`, Json, "POST", {
              text:
                "editable" in item
                  ? `${item.prompt}\nWork only in this fixture directory. Edit only: ${item.editable.join(", ")}. Run bun test or bun run test in the foreground and inspect the result. Do not change tests or package metadata, install dependencies, use the network, invoke skills, delegate or start background processes. Report what changed and the actual verification result.`
                  : `${item.prompt}\nReturn only the requested JSON object, with no Markdown or commentary. Work only in this fixture directory; the only permitted tool is read. Do not run commands, edit files, invoke skills or delegate.`,
            })
            const deadline = performance.now() + planned.timeoutMs
            const outcome = await (async () => {
              while (true) {
                const value = await api(`/api/session/${session.data.id}`, Session)
                if (value.data.outcome) return value.data.outcome
                if (performance.now() > deadline) {
                  await api(`/api/session/${session.data.id}/interrupt`, Json, "POST", {})
                  return "timeout"
                }
                await Bun.sleep(100)
              }
            })()
            const durationMs = performance.now() - started
            // Interruption requests cancellation; wait for the owner to release the Session before inspecting files.
            await api(`/api/experimental/session/${session.data.id}/wait`, Json, "POST")
            const completed = await api(`/api/session/${session.data.id}`, Session)
            const messages = await api(`/api/session/${session.data.id}/message`, Messages)
            const evaluationStarted = performance.now()
            const evaluationDeadline = performance.now() + 10_000
            const observed = await (async () => {
              while (true) {
                const values = await api(
                  `/api/experimental/intelligence/history?sessionID=${session.data.id}`,
                  Schema.Array(Intelligence.Evaluation),
                )
                const status = await api(
                  `/api/experimental/intelligence?sessionID=${session.data.id}`,
                  Intelligence.Status,
                )
                const settled = evaluationsSettled(mode, values, status.observations?.pending)
                if (
                  (settled &&
                    (mode === "single" ||
                      outcome !== "succeeded" ||
                      (values.some((value) => value.operation === "prompt_classification") &&
                        values.some((value) => value.operation === "response_quality")))) ||
                  performance.now() > evaluationDeadline
                )
                  return { evaluations: values, settled }
                await Bun.sleep(100)
              }
            })()
            const evaluations = observed.evaluations
            const advisoryWaitMs = mode === "dual" ? performance.now() - evaluationStarted : 0
            const observationWaitMs = mode === "observe" ? performance.now() - started - durationMs : 0
            const budget = await api(`/api/session/${session.data.id}/budget`, Budget)
            const chronological = messages.data.toSorted(
              (left, right) =>
                DateTime.toEpochMillis(left.time.created) - DateTime.toEpochMillis(right.time.created) ||
                left.id.localeCompare(right.id),
            )
            const assistants = chronological.filter((message) => message.type === "assistant")
            const finals = assistants
              .filter((message) => message.finish === "stop" || message.finish === "length")
              .map(
                (message) =>
                  message.content?.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("") ?? "",
              )
              .filter(Boolean)
            const s2Tokens = TokenUsage.total(completed.data.tokens)
            const s1Tokens = evaluations.reduce(
              (sum, evaluation) => sum + evaluation.usage.input_tokens + evaluation.usage.output_tokens,
              0,
            )
            const reads = assistants
              .flatMap((message) => message.content ?? [])
              .filter(
                (part) => part.type === "tool" && part.name === "read" && part.state.status === "completed",
              ).length
            const commands = assistants
              .flatMap((message) => message.content ?? [])
              .filter(
                (part) =>
                  part.type === "tool" &&
                  part.name === "shell" &&
                  part.state.status === "completed" &&
                  (part.state.input.command === "bun test" || part.state.input.command === "bun run test") &&
                  part.state.metadata?.exit === 0,
              ).length
            const shellLocation = `?${new URLSearchParams({ "location[directory]": directory })}`
            const running =
              "editable" in item
                ? await api(`/api/shell${shellLocation}`, Schema.Struct({ data: Schema.Array(Shell.Info) }))
                : undefined
            const unsettledShell =
              Boolean(running?.data.length) ||
              assistants
                .flatMap((message) => message.content ?? [])
                .some(
                  (part) =>
                    part.type === "tool" &&
                    part.name === "shell" &&
                    part.state.status === "completed" &&
                    (part.state.input.background === true ||
                      part.state.metadata?.exit === undefined ||
                      (part.state.input.command !== "bun test" && part.state.input.command !== "bun run test")),
                )
            for (const shell of running?.data ?? []) await api(`/api/shell/${shell.id}${shellLocation}`, Json, "DELETE")
            const verification =
              "editable" in item && !unsettledShell && observed.settled
                ? await verify(item, directory, path.join(root, "oracles", current.run))
                : undefined
            const finalGrade =
              "editable" in item
                ? before && verification
                  ? grade(item, before, await snapshot(directory), verification)
                  : {
                      pass: false,
                      score: 0,
                      format: false,
                      failed: ["unsettled_execution"],
                      changes: { added: [], modified: [], deleted: [] },
                    }
                : undefined
            const repairMessages = chronological.filter(
              (message) => message.type === "synthetic" && message.metadata?.responseRepair !== undefined,
            )
            const repairs = repairMessages.length
            const firstRepair = repairMessages[0]
            const repairID = firstRepair?.type === "synthetic" ? firstRepair.metadata?.responseRepair : undefined
            const evaluationID = Schema.decodeUnknownOption(Schema.Struct({ evaluationID: Schema.String }))(repairID)
            const recordedCandidate = Schema.decodeUnknownOption(Schema.Struct({ candidateID: Schema.String }))(
              repairID,
            )
            const candidateID = Option.isSome(recordedCandidate)
              ? recordedCandidate.value.candidateID
              : Option.isSome(evaluationID)
                ? evaluations.find((evaluation) => evaluation.id === evaluationID.value.evaluationID)?.candidateID
                : undefined
            const candidate = messages.data.find((message) => message.id === candidateID)
            const tree = candidate?.type === "assistant" ? candidate.snapshot?.end : undefined
            const recovered =
              "editable" in item && repairs > 0 && tree && observed.settled && !unsettledShell
                ? await recover({
                    home,
                    directory,
                    projectID: session.data.projectID,
                    tree,
                    metadata: path.join(root, "repositories", item.id),
                    destination: path.join(root, "candidates", current.run),
                  })
                : undefined
            const initialVerification =
              recovered?.known && "editable" in item
                ? await verify(
                    item,
                    path.join(root, "candidates", current.run),
                    path.join(root, "oracles", `${current.run}-initial`),
                  )
                : undefined
            const initialGrade =
              initialVerification && before && "editable" in item
                ? grade(item, before, await snapshot(path.join(root, "candidates", current.run)), initialVerification)
                : undefined
            const requests = upstream.filter((request) => request.run === current.run && request.model === pair.model)
            const s1Requests = upstream.filter(
              (request) => request.run === current.run && request.model === pair.evaluator,
            )
            const s1CostUsd = cost(s1Requests, evaluatorEstimate(evaluations, prices?.s1))
            const s2CostUsd = cost(
              requests,
              prices
                ? (completed.data.tokens.input * prices.s2.input +
                    (completed.data.tokens.output + completed.data.tokens.reasoning) * prices.s2.output +
                    completed.data.tokens.cache.read * prices.s2.cacheRead +
                    completed.data.tokens.cache.write * prices.s2.cacheWrite) /
                    1_000_000
                : undefined,
            )
            const responseModels = [...new Set(requests.flatMap((request) => request.responseModels))]
            const evaluatorResponseModels = [...new Set(s1Requests.flatMap((request) => request.responseModels))]
            const validationErrors = [
              ...(!observed.settled ? [mode === "observe" ? "unsettled_observation" : "unsettled_classification"] : []),
              ...(unsettledShell ? ["unsettled_shell"] : []),
              ...(budget.data.spent.tokens !== s1Tokens + s2Tokens ? ["budget_accounting"] : []),
              ...(mode === "single" && evaluations.length ? ["unexpected_s1"] : []),
              ...(mode !== "single" &&
              outcome === "succeeded" &&
              !evaluations.some((evaluation) => evaluation.operation === "prompt_classification")
                ? ["missing_classification"]
                : []),
              ...(mode !== "single" &&
              outcome === "succeeded" &&
              !evaluations.some((evaluation) => evaluation.operation === "response_quality")
                ? ["missing_response_review"]
                : []),
              ...(Object.keys(item.files).length && !reads ? ["fixture_not_read"] : []),
              ...("editable" in item && !commands ? ["fixture_not_executed"] : []),
              ...([...requests, ...s1Requests].some((request) => !request.complete)
                ? ["incomplete_provider_response"]
                : []),
              ...(!assistants.length || !assistants.every((message) => message.model?.id === pair.model)
                ? ["s2_selection_changed"]
                : []),
              ...(pair.variant && assistants.some((message) => message.model?.variant !== pair.variant)
                ? ["s2_variant_changed"]
                : []),
              ...(responseModels.length !== 1 || responseModels[0] !== pair.responseModel
                ? ["upstream_model_changed"]
                : []),
              ...(evaluations.some(
                (evaluation) =>
                  !evaluation.evaluator ||
                  evaluation.evaluator.model !== pair.evaluator ||
                  evaluation.evaluator.transport !== "red-router" ||
                  evaluation.evaluator.baseURL !== baseURL,
              )
                ? ["s1_selection_changed"]
                : []),
              ...(mode !== "single" &&
              pair.evaluatorResponseModel &&
              (evaluatorResponseModels.length !== 1 || evaluatorResponseModels[0] !== pair.evaluatorResponseModel)
                ? ["evaluator_upstream_model_changed"]
                : []),
            ]
            const result = {
              caseID: item.id,
              corpus: planned.corpus,
              pairID: pair.id,
              experiment,
              split: "split" in item ? item.split : ("calibration" as const),
              ...("family" in item ? { family: item.family } : {}),
              taskKind: "editable" in item ? ("coding" as const) : ("read-only" as const),
              round,
              mode,
              outcome: validationErrors.length ? "invalid" : outcome,
              executionOutcome: outcome,
              failureKind:
                outcome === "timeout"
                  ? "execution_timeout"
                  : validationErrors.length
                    ? "contract_or_accounting"
                    : outcome !== "succeeded"
                      ? "execution_failure"
                      : !finalGrade?.pass && "editable" in item
                        ? "behavior_failure"
                        : null,
              validationErrors,
              responseModels,
              evaluatorResponseModels,
              responseVariants: [...new Set(assistants.map((message) => message.model?.variant ?? null))],
              durationMs,
              observationWaitMs,
              advisoryWaitMs,
              sessionID: session.data.id,
              initialText: finals[0] ?? "",
              finalText: finals.at(-1) ?? "",
              initial: "expected" in item ? score(finals[0] ?? "", item.expected) : (initialGrade ?? finalGrade!),
              final: "expected" in item ? score(finals.at(-1) ?? "", item.expected) : finalGrade!,
              repairs,
              repairBaselineKnown: !("editable" in item) || repairs === 0 || initialGrade !== undefined,
              ...(repairs && "editable" in item
                ? {
                    repairBaseline: {
                      candidateID,
                      snapshot: tree,
                      known: initialGrade !== undefined,
                      reason:
                        recovered && !recovered.known
                          ? recovered.reason
                          : initialGrade
                            ? undefined
                            : "candidate_snapshot_missing",
                      verification: initialVerification,
                      grade: initialGrade,
                    },
                  }
                : {}),
              ...(finalGrade && verification
                ? {
                    oracleMs: verification.process.durationMs,
                    verification,
                    fileChanges: finalGrade.changes,
                    changes: [
                      ...finalGrade.changes.added,
                      ...finalGrade.changes.modified,
                      ...finalGrade.changes.deleted,
                    ],
                  }
                : {}),
              commands,
              reads,
              s1Tokens,
              s2Tokens,
              s2CostUsd: s2CostUsd ?? 0,
              s2Unpriced: s2CostUsd === undefined,
              ...(s1CostUsd === undefined ? {} : { s1CostUsd }),
              evaluatorFailures: evaluations.filter((evaluation) => evaluation.decision === "unavailable").length,
              fixedModel: assistants.every((message) => message.model?.id === pair.model),
              evaluations,
              funnel: trace(chronological, evaluations, directory),
              reviewEvidence: await Promise.all(
                evaluations
                  .filter((evaluation) => evaluation.operation === "response_quality")
                  .map(async (evaluation) => ({
                    id: evaluation.id,
                    evidence: await api(
                      `/api/experimental/intelligence/evidence/${evaluation.id}?${new URLSearchParams({ sessionID: session.data.id })}`,
                      Json,
                    ),
                  })),
              ),
              budget,
            }
            results.push(result)
            await Bun.write(
              path.join(output, `${current.run}.json`),
              JSON.stringify(
                {
                  ...result,
                  requests: upstream.filter((request) => request.run === current.run),
                  messages: messages.data,
                },
                null,
                2,
              ),
            )
            await Bun.write(
              path.join(output, "report.json"),
              JSON.stringify(
                {
                  version,
                  ...manifest,
                  maxCostUsd,
                  knownCostUsd: results.reduce(
                    (total, result) => total + result.s2CostUsd + (result.s1CostUsd ?? 0),
                    0,
                  ),
                  completed: results.length === planned.expectedExecutions,
                  summary: summarize(results),
                  acceptance: campaign(results, planned.plans, planned.expectedExecutions),
                  pairs: pairs(results),
                  runs: results,
                  requests: metrics,
                  upstreamRequests: upstream,
                },
                null,
                2,
              ),
            )
            await Bun.write(
              path.join(output, "report.md"),
              markdown(results, planned.pairs[0]!.model, planned.pairs[0]!.evaluator, planned.expectedComparisons, {
                suite: planned.suite,
                corpus: planned.corpus,
                signature: manifest.fixtureSignature,
                pairs: planned.pairs,
                plans: planned.plans,
                expectedExecutions: planned.expectedExecutions,
              }),
            )
            console.log(
              JSON.stringify({
                run: current.run,
                outcome: result.outcome,
                passed: result.final.pass,
                failed: result.final.failed,
                durationMs: Math.round(durationMs),
                s1Tokens,
                s2Tokens,
                repairs: result.repairs,
                reads: result.reads,
                fixedModel: result.fixedModel,
                validationErrors,
              }),
            )
            if (unsettledShell || outcome === "timeout")
              throw new Error("Campaign stopped: timed out or background work cannot be safely reused")
            if (mode === "observe" && result.outcome !== "succeeded")
              throw new Error("Campaign stopped: observation did not settle before the collection deadline")
            if (!observed.settled)
              throw new Error(
                "Campaign stopped: asynchronous evaluations did not settle before the collection deadline",
              )
          }
        }
      }
    }
  }
  console.log(JSON.stringify({ output, summary: summarize(results) }))
  if (
    maxCostUsd !== undefined &&
    results.reduce((total, result) => total + result.s2CostUsd + (result.s1CostUsd ?? 0), 0) > maxCostUsd
  )
    process.exitCode = 1
  if (args.gate && !campaign(results, planned.plans, planned.expectedExecutions).passed) process.exitCode = 1
} catch (error) {
  failure.message = (error instanceof Error ? error.message : String(error)).replaceAll(key, "[redacted]")
  throw error
} finally {
  try {
    if (service.started) {
      await cli("service", "stop")
      service.started = false
    }
  } finally {
    try {
      await Bun.write(
        path.join(output, "campaign-state.json"),
        JSON.stringify(
          {
            currentRun: current.run,
            completed: !failure.message && results.length === planned.expectedExecutions,
            error: failure.message ?? (service.started ? "Isolated service did not stop" : undefined),
            ...(service.started ? { retainedDirectory: root } : {}),
            runs: results,
            requests: metrics,
            upstreamRequests: upstream,
          },
          null,
          2,
        ),
      )
    } finally {
      router.stop(true)
      if (!service.started) await rm(root, { recursive: true, force: true })
    }
  }
}

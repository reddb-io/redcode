import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { parseArgs } from "node:util"
import { TokenUsage } from "@opencode/schema/token-usage"
import { Intelligence } from "@opencode/schema/intelligence"
import { SessionMessage } from "@opencode/schema/session-message"
import { Model } from "@opencode/schema/model"
import { Schema } from "effect"
import { cases } from "./cases"
import { acceptance, markdown, pairs, score, summarize, type Run } from "./report"
import { proxy, type RequestMetric } from "./transport"

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
  },
}).values
if (!args.model || !args["response-model"] || !args["key-file"] || !args.output)
  throw new Error(
    "Usage: bun run script/reasoning-eval/run.ts --model <fixed-router-model> --response-model <actual-upstream-model> --key-file <private-file> --output <directory> [--rounds 2]",
  )
if (args.model.startsWith("auto/")) throw new Error("Use a pinned model, not an automatic router combo")
const rounds = Number(args.rounds)
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error("Rounds must be between 1 and 10")
const selected = args.cases ? cases.filter((item) => args.cases!.split(",").includes(item.id)) : cases
if (!selected.length || (args.cases && selected.length !== new Set(args.cases.split(",")).size))
  throw new Error("Unknown or empty case selection")
const binary = Bun.which(args.binary!) ?? path.resolve(args.binary!)
const output = path.resolve(args.output)
const key = (await Bun.file(args["key-file"]).text()).trim()
if (!key) throw new Error("Empty API key file")
const Rate = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const prices = args.pricing
  ? Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          model: Schema.String,
          evaluator: Schema.String,
          source: Schema.String,
          s2: Schema.Struct({ input: Rate, output: Rate, cacheRead: Rate, cacheWrite: Rate }),
          s1: Schema.optional(Schema.Struct({ input: Rate, output: Rate })),
        }),
      ),
    )(await Bun.file(args.pricing).text())
  : undefined
if (prices && (prices.model !== args.model || prices.evaluator !== args.evaluator))
  throw new Error("Pricing must match the exact pinned S1 and S2 models")
const root = await mkdtemp(path.join(os.tmpdir(), "redcode-reasoning-eval-"))
const home = path.join(root, "home")
const setup = path.join(root, "setup")
await Promise.all([home, setup, output].map((directory) => mkdir(directory, { recursive: true })))
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: home,
  USERPROFILE: home,
  REDCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local/share"),
  XDG_STATE_HOME: path.join(home, ".local/state"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  TMPDIR: root,
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
  }
> = []
const service = { url: "", password: "", started: false }
const Json = Schema.Json
const Session = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
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
      if (catalog.data.some((model) => model.providerID === "red-router" && model.id === args.model)) return catalog
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
  const selectedModel = catalog.data.find((model) => model.providerID === "red-router" && model.id === args.model)!
  if (selectedModel.flat || selectedModel.offers?.length || selectedModel.upstream?.category === "combo")
    throw new Error("Choose a model pinned to one upstream, not a router policy")
  const principal = { providerID: "red-router", id: args.model, connection: { type: "credential", id: credential.id } }
  const evaluator = { transport: "red-router", baseURL, model: args.evaluator, credentialID: credential.id }
  const settings = { enabled: true, onboarding: "completed", principal, evaluator }
  await api("/api/experimental/intelligence/models", Intelligence.Models, "POST", { evaluator })
  await Bun.write(
    path.join(output, "configuration.json"),
    JSON.stringify(
      {
        version,
        model: args.model,
        responseModel: args["response-model"],
        evaluator: args.evaluator,
        router: args.router,
        rounds,
        expectedRuns: selected.length * rounds * 2,
        cases: selected,
        prices: selectedModel.cost,
        priceOverride: prices ?? null,
        note: "Upstream reported charges take precedence over explicit USD-per-million-token estimates. Unknown total cost fails acceptance.",
      },
      null,
      2,
    ),
  )
  // Fixtures are read-only. Reuse one Location per case so later rounds do not measure
  // the accumulated cost of loading a new Location for every fresh Session.
  await Promise.all(
    selected.map(async (item) => {
      const directory = path.join(root, item.id)
      await mkdir(directory)
      await Promise.all(Object.entries(item.files).map(([name, text]) => Bun.write(path.join(directory, name), text)))
    }),
  )
  for (const round of Array.from({ length: rounds }, (_, index) => index + 1)) {
    for (const [index, item] of selected.entries()) {
      for (const mode of (round + index) % 2 ? (["single", "dual"] as const) : (["dual", "single"] as const)) {
        current.run = `${item.id}-${round}-${mode}`
        const directory = path.join(root, item.id)
        await api("/api/experimental/intelligence", Json, "PUT", { settings: { ...settings, reasoning: mode } })
        const session = await api("/api/session", Session, "POST", {
          title: current.run,
          agent: "build",
          model: principal,
          location: { directory },
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            ...Object.keys(item.files).map((name) => ({ action: "read", resource: name, effect: "allow" })),
          ],
        })
        const started = performance.now()
        await api(`/api/session/${session.data.id}/prompt`, Json, "POST", {
          text: `${item.prompt}\nReturn only the requested JSON object, with no Markdown or commentary. Work only in this fixture directory; the only permitted tool is read. Do not run commands, edit files, invoke skills or delegate.`,
        })
        const deadline = performance.now() + 90_000
        const completed = await (async () => {
          while (true) {
            const value = await api(`/api/session/${session.data.id}`, Session)
            if (value.data.outcome) return value
            if (performance.now() > deadline) {
              await api(`/api/session/${session.data.id}/interrupt`, Json, "POST", {})
              return { data: { ...value.data, outcome: "timeout" } }
            }
            await Bun.sleep(100)
          }
        })()
        const durationMs = performance.now() - started
        const messages = await api(`/api/session/${session.data.id}/message`, Messages)
        const evaluationDeadline = performance.now() + 10_000
        const evaluations = await (async () => {
          while (true) {
            const values = await api(
              `/api/experimental/intelligence/history?sessionID=${session.data.id}`,
              Schema.Array(Intelligence.Evaluation),
            )
            if (
              mode === "single" ||
              completed.data.outcome !== "succeeded" ||
              values.some((value) => value.operation === "prompt_classification") ||
              performance.now() > evaluationDeadline
            )
              return values
            await Bun.sleep(100)
          }
        })()
        const budget = await api(`/api/session/${session.data.id}/budget`, Budget)
        const assistants = messages.data.filter((message) => message.type === "assistant")
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
          .filter((part) => part.type === "tool" && part.name === "read" && part.state.status === "completed").length
        const requests = upstream.filter((request) => request.run === current.run && request.model === args.model)
        const s1Requests = upstream.filter((request) => request.run === current.run && request.model === args.evaluator)
        const s1CostUsd =
          s1Requests.length && s1Requests.every((request) => request.complete && request.costUsd !== undefined)
            ? s1Requests.reduce((sum, request) => sum + request.costUsd!, 0)
            : prices?.s1
              ? evaluations.reduce(
                  (sum, evaluation) =>
                    sum +
                    evaluation.usage.input_tokens * prices.s1!.input +
                    evaluation.usage.output_tokens * prices.s1!.output,
                  0,
                ) / 1_000_000
              : undefined
        const s2CostUsd =
          requests.length && requests.every((request) => request.complete && request.costUsd !== undefined)
            ? requests.reduce((sum, request) => sum + request.costUsd!, 0)
            : prices
              ? (completed.data.tokens.input * prices.s2.input +
                  (completed.data.tokens.output + completed.data.tokens.reasoning) * prices.s2.output +
                  completed.data.tokens.cache.read * prices.s2.cacheRead +
                  completed.data.tokens.cache.write * prices.s2.cacheWrite) /
                1_000_000
              : selectedModel.cost.length
                ? completed.data.cost
                : undefined
        const responseModels = [...new Set(requests.flatMap((request) => request.responseModels))]
        const validationErrors = [
          ...(budget.data.spent.tokens !== s1Tokens + s2Tokens ? ["budget_accounting"] : []),
          ...(mode === "single" && evaluations.length ? ["unexpected_s1"] : []),
          ...(mode === "dual" &&
          completed.data.outcome === "succeeded" &&
          !evaluations.some((evaluation) => evaluation.operation === "prompt_classification")
            ? ["missing_classification"]
            : []),
          ...(mode === "dual" &&
          completed.data.outcome === "succeeded" &&
          !evaluations.some((evaluation) => evaluation.operation === "response_quality")
            ? ["missing_response_review"]
            : []),
          ...(Object.keys(item.files).length && !reads ? ["fixture_not_read"] : []),
          ...(!assistants.length || !assistants.every((message) => message.model?.id === args.model)
            ? ["s2_selection_changed"]
            : []),
          ...(responseModels.length !== 1 || responseModels[0] !== args["response-model"]
            ? ["upstream_model_changed"]
            : []),
        ]
        const result = {
          caseID: item.id,
          round,
          mode,
          outcome: validationErrors.length ? "invalid" : (completed.data.outcome ?? "unknown"),
          validationErrors,
          responseModels,
          durationMs,
          sessionID: session.data.id,
          initialText: finals[0] ?? "",
          finalText: finals.at(-1) ?? "",
          initial: score(finals[0] ?? "", item.expected),
          final: score(finals.at(-1) ?? "", item.expected),
          repairs: messages.data.filter(
            (message) => message.type === "synthetic" && message.metadata?.responseRepair !== undefined,
          ).length,
          reads,
          s1Tokens,
          s2Tokens,
          s2CostUsd: s2CostUsd ?? 0,
          s2Unpriced: s2CostUsd === undefined,
          ...(s1CostUsd === undefined ? {} : { s1CostUsd }),
          evaluatorFailures: evaluations.filter((evaluation) => evaluation.decision === "unavailable").length,
          fixedModel: assistants.every((message) => message.model?.id === args.model),
          evaluations,
          budget,
        }
        results.push(result)
        await Bun.write(
          path.join(output, `${current.run}.json`),
          JSON.stringify(
            { ...result, requests: upstream.filter((request) => request.run === current.run), messages: messages.data },
            null,
            2,
          ),
        )
        await Bun.write(
          path.join(output, "report.json"),
          JSON.stringify(
            {
              version,
              model: args.model,
              evaluator: args.evaluator,
              expectedRuns: selected.length * rounds * 2,
              completed: results.length === selected.length * rounds * 2,
              summary: summarize(results),
              acceptance: acceptance(results, selected.length * rounds * 2),
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
          markdown(results, args.model, args.evaluator!, selected.length * rounds * 2),
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
      }
    }
  }
  console.log(JSON.stringify({ output, summary: summarize(results) }))
  if (args.gate && !acceptance(results, selected.length * rounds * 2).passed) process.exitCode = 1
} finally {
  try {
    if (service.started) await cli("service", "stop")
  } finally {
    router.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}

// Test-only worker: production HTTP/auth/execution/tools, deterministic model responses.
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer, Stream } from "effect"
import { mkdir } from "node:fs/promises"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { LanguageModel, LLMClient } from "../../../ai/src"
import { OpenAIChat } from "../../../ai/src/protocols/openai-chat"
import { TestLLM } from "../../../ai/src/testing"
import { ServerFetch } from "../../src/fetch"

const main = Effect.gen(function* () {
  const id = process.env.WORKER_ID
  const password = process.env.WORKER_PASSWORD
  if (!id || !password) throw new Error("Set WORKER_ID and WORKER_PASSWORD for this test-only worker")
  yield* Effect.promise(async () => {
    await mkdir("/lab/checkout", { recursive: true })
    await mkdir("/lab/home", { recursive: true })
    if (!(await Bun.file("/lab/checkout/.git/HEAD").exists())) {
      await Bun.write("/lab/checkout/README.md", "Docker worker acceptance checkout\n")
      for (const args of [
        ["init", "-q"],
        ["add", "."],
      ]) {
        const child = Bun.spawn(["git", ...args], { cwd: "/lab/checkout", stdout: "ignore", stderr: "pipe" })
        const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
        if (code) throw new Error(stderr)
      }
    }
  })
  const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
  yield* llm.serve((request) => {
    const index = request.messages.findLastIndex(
      (message) =>
        message.role === "user" &&
        message.content.some((part) => part.type === "text" && part.text.includes("[worker-task:")),
    )
    const text =
      request.messages[index]?.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? ""
    const task = /\[worker-task:([a-zA-Z0-9_-]+)\]/.exec(text)?.[1]
    if (!task) return TestLLM.text("Docker fixture requires a [worker-task:ID] prompt", "fixture")
    const results = request.messages
      .slice(index + 1)
      .flatMap((message) => message.content)
      .filter((part) => part.type === "tool-result")
    const response = !results.some((part) => part.name === "write")
      ? TestLLM.tool(`write_${task}`, "write", { path: `output/${task}.txt`, content: `${id} completed ${task}\n` })
      : !results.some((part) => part.name === "shell")
        ? TestLLM.tool(`shell_${task}`, "shell", {
            command: "uname -s && git status --short",
            description: "Verify Linux and Git in the worker checkout",
          })
        : TestLLM.text(`${id} completed ${task} on Linux`, task)
    // A slow first step gives the acceptance runner time to kill/restart this owned container.
    const delay = text.includes("[slow]") && !results.length ? "8 seconds" : "500 millis"
    return Stream.fromEffect(Effect.sleep(delay)).pipe(Stream.flatMap(() => Stream.fromIterable(response)))
  })
  const model = SessionRunnerModel.resolved(
    LanguageModel.make({ id: "docker-fixture", provider: "test", route: OpenAIChat.route }),
    {
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      cost: [],
      limit: { context: 200_000, output: 8_192 },
    },
  )
  const handler = yield* ServerFetch.make(
    {
      password,
      app: { name: "redcode-worker-lab", version: "source" },
      database: { path: "/lab/worker.db" },
      workers: { directory: "/lab/coordinator" },
      config: {
        directory: "/lab/checkout",
        global: false,
        project: false,
        content: JSON.stringify({
          worktree: { auto: false },
          permissions: [{ action: "shell", resource: "*", effect: "allow" }],
        }),
      },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    },
    {
      overrides: [
        llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
        SessionRunnerModel.node.replace(
          Layer.succeed(SessionRunnerModel.Service, { resolve: () => Effect.succeed(model) }),
        ),
      ],
    },
  )
  const server = Bun.serve({ hostname: "0.0.0.0", port: 4096, fetch: (request) => handler(request) })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      server.stop(true)
    }),
  )
  process.stdout.write(
    JSON.stringify({ ready: true, worker: id, checkout: "/lab/checkout", model: "deterministic-test-fixture" }) + "\n",
  )
  yield* Effect.never
})

NodeRuntime.runMain(main.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

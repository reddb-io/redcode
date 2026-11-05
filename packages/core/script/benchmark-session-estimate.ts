// Isolated microbenchmark of production prompt estimation, not an end-to-end session benchmark.
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "../src/agent"
import { SessionCompaction } from "../src/session/compaction"
import { SessionMessage } from "../src/session/message"
import { SessionRunnerModel } from "../src/session/runner/model"
import type { SessionContext } from "../src/session/context"
import { DateTime, Effect } from "effect"

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "fixture", provider: "fixture", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    cost: [],
    limit: { context: 1_000_000, output: 32_000 },
  },
)
const messages = Array.from({ length: 1_000 }, (_, index) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text: `Message ${index}: ${"fixture ".repeat(250)}`,
    time: { created: DateTime.makeUnsafe(index) },
  }),
)
const context = {
  session: {},
  messages,
  model,
  agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
  initial: "Instructions",
  tools: { definitions: [], execute: () => Effect.die("not used") },
} as unknown as SessionContext.Loaded
const old = () => {
  SessionCompaction.estimateContext(context, 1.25)
  SessionCompaction.estimatePrompt(context)
}
const reused = () => {
  const estimate = SessionCompaction.estimatePrompt(context)
  SessionCompaction.estimateContext(context, 1.25, estimate)
}
for (let index = 0; index < 5; index++) {
  old()
  reused()
}
const before: number[] = []
const after: number[] = []
for (let index = 0; index < 30; index++) {
  for (const [run, samples] of index % 2
    ? ([
        [reused, after],
        [old, before],
      ] as const)
    : ([
        [old, before],
        [reused, after],
      ] as const)) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
}
const median = (samples: number[]) => samples.toSorted((a, b) => a - b)[Math.floor(samples.length / 2)]
console.log(
  JSON.stringify({
    messages: messages.length,
    iterations: 30,
    beforeMedianMs: median(before),
    afterMedianMs: median(after),
  }),
)

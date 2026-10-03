import { DateTime, Schema } from "effect"
import { SessionMessage } from "@opencode/core/session/message"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"

export const user = (id: string, text = id) =>
  SessionMessage.User.make({
    type: "user",
    id: SessionMessage.ID.make(id),
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })
export const tool = (
  id: string,
  name: string,
  input: unknown,
  options: {
    exit?: number
    completed?: number
    error?: string
    pending?: boolean
    output?: string
    metadata?: Record<string, string | boolean>
  } = {},
) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    type: "assistant",
    id,
    agent: "build",
    model: { providerID: "test", id: "model" },
    time: { created: 0, ...(options.pending ? {} : { completed: options.completed ?? 1 }) },
    content: [
      {
        type: "tool",
        id: `call_${id}`,
        name,
        state: options.pending
          ? { status: "running", input, metadata: {} }
          : options.error
            ? { status: "error", input, error: { type: "failed", message: options.error } }
            : {
                status: "completed",
                input,
                metadata: { ...options.metadata, ...(options.exit === undefined ? {} : { exit: options.exit }) },
                content: [{ type: "text", text: options.output ?? "OK" }],
              },
        time: { created: 0, completed: options.completed ?? 1 },
      },
    ],
  })
export const evaluation = (extra: Partial<Intelligence.Evaluation> = {}): Intelligence.Evaluation => ({
  id: "eval_before",
  fingerprint: "hash",
  sessionID: "ses_fixture",
  operation: "response_quality",
  kind: "gate",
  subjectID: "msg_request",
  candidateID: "msg_candidate",
  policy: IntelligenceEvaluation.POLICY,
  decision: "needs_revision",
  mode: "dual",
  model: "jev",
  answers: { correctness: { type: "noul", noul: 0.97 } },
  issues: ["correctness"],
  created: 1,
  duration: 1,
  usage: { input_tokens: 10, output_tokens: 1, cost: 0.001 },
  ...extra,
})

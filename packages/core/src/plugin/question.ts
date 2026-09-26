export * as QuestionPlugin from "./question.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { QUESTION_INSTRUCTIONS } from "../question-instructions.js"

export const Plugin = define({
  id: "redcode.question",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("question"), (item) => {
        item.name = Agent.Name.make("Question")
        item.description = "Question mode. Asks focused investigative questions with read-only access."
        item.system = QUESTION_INSTRUCTIONS
        item.mode = "primary"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "ask" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          ...["glob", "grep", "question", "session_history"].map((action) => ({
            action,
            resource: "*",
            effect: "allow" as const,
          })),
        )
      })
    })
  }),
})

export * as SessionArtifactTool from "./session-artifact.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { SessionArtifacts } from "../../session/artifacts.js"
import { Permission } from "../../permission.js"

const Input = Schema.Struct({
  action: Schema.Literals(["list", "publish"]),
  source: Schema.optionalKey(Schema.String),
  entry: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  expectedRevision: Schema.optionalKey(Schema.String),
})

export const Plugin = {
  id: "redcode.tool.session-artifact",
  effect: Effect.fn("SessionArtifactTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const store = SessionArtifacts.createStore()
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "session_artifact",
          description:
            "List artifacts in this conversation or publish a snapshot of a folder inside its workspace to Delivery. Publish requires source (workspace-relative folder), entry (file within that folder) and title for a new artifact. To update, provide id and expectedRevision from the latest listed revision; earlier revisions remain available. Preview is isolated and scripts and external resources are disabled.",
          input: Input,
          output: Schema.String,
          options: { codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.action === "publish") {
                if (!input.source || !input.entry)
                  return yield* new ToolFailure({ message: "Provide source and entry" })
                yield* permission
                  .assert({
                    action: "artifact.publish",
                    resources: [input.source],
                    save: [input.source],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: "Artifact publication denied", error })))
              }
              const result = yield* Effect.tryPromise({
                try: async (): Promise<SessionArtifacts.Info | SessionArtifacts.Info[]> =>
                  input.action === "list"
                    ? await store.list(context.sessionID)
                    : await store.publish({
                        sessionID: context.sessionID,
                        directory: ctx.location.directory,
                        source: input.source!,
                        entry: input.entry!,
                        title: input.title,
                        id: input.id,
                        expectedRevision: input.expectedRevision,
                      }),
                catch: (error) =>
                  new ToolFailure({ message: error instanceof Error ? error.message : "Artifact request failed" }),
              })
              const text = JSON.stringify(result)
              return { output: text, content: text }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

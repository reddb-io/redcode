export * as DesignDocumentToolPlugin from "./design-document.js"

import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Global } from "@opencode/util/global"
import { Effect, Ref, Schema } from "effect"
import { DesignDetection } from "../../design/detection.js"
import { DesignBuild } from "../../design/build.js"
import { DesignDocumentTool } from "../../design/document-tool.js"
import { DesignIdentify } from "../../design/identify.js"
import { DesignProposal } from "../../design/proposal.js"
import { DesignRounds } from "../../design/rounds.js"
import { DesignStore } from "../../design/store.js"
import { DesignSystem } from "../../design/system.js"
import { DesignTarget } from "../../design/target.js"
import { Form } from "../../form.js"
import { Intelligence } from "../../intelligence.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { SessionStore } from "../../session/store.js"
import type { Tool } from "../../tool.js"

export const name = "design_document"

export const Plugin = {
  id: "redcode.tool.design-document",
  effect: Effect.fn("DesignDocumentTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    const intelligence = yield* Intelligence.Service
    const sessions = yield* SessionStore.Service
    const location = yield* Location.Service
    const global = yield* Global.Service

    const ask = (context: Tool.Context, request: ReturnType<typeof DesignProposal.question>) =>
      forms
        .ask({
          sessionID: context.sessionID,
          title: request.header,
          metadata: { kind: "question", tool: { messageID: context.messageID, id: context.id } },
          fields: [
            {
              key: "choice",
              title: request.header,
              description: request.question,
              type: "string" as const,
              options: request.options.map((option) => ({
                value: option.label,
                label: option.label,
                description: option.description,
              })),
              custom: request.custom,
            },
          ],
        })
        .pipe(
          Effect.orDie,
          Effect.map((state) => (state.status === "answered" ? String(state.answer.choice ?? "") : undefined)),
        )

    const proposal = Effect.fn("DesignDocumentTool.proposal")(function* (
      context: Tool.Context,
      application: string | undefined,
      answer: DesignIdentify.Answer | undefined,
      auto: boolean,
    ) {
      const configured = yield* designs.configured(context.sessionID)
      const stale = yield* Effect.promise(() => DesignProposal.stale(location.directory, configured).catch(() => false))
      const mode = IntelligenceEvaluation.mode(yield* intelligence.read())
      return {
        directory: location.directory,
        application,
        state: path.join(global.state, DesignProposal.STATE),
        global: global.config,
        configured: configured?.system !== undefined && !stale,
        replace: stale,
        auto,
        identify: (checked: string | undefined) =>
          DesignIdentify.identify({
            directory: location.directory,
            application: checked,
            state: path.join(global.state, DesignIdentify.STATE),
            mode,
            sessionID: context.sessionID,
            answer,
            evaluate: (evaluation) => intelligence.evaluate(evaluation),
          }),
        adopt: (design: Parameters<typeof designs.adopt>[1], committed?: boolean) =>
          designs.adopt(context.sessionID, design, committed),
        ask: (request: ReturnType<typeof DesignProposal.question>) => ask(context, request),
      }
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: DesignDocumentTool.description,
          input: DesignDocumentTool.Input,
          output: Schema.Union([Schema.Array(Design.Info), Schema.String]),
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              // The TUI and web show the chip and the identification's headline in place of the call.
              const display = yield* Ref.make<Record<string, string>>({})
              const output = yield* Effect.gen(function* () {
                if (input.action === "list") return yield* designs.list(context.sessionID)
                if (input.action === "detect")
                  return yield* DesignDetection.report({ application: input.input?.application, pack: true }).pipe(
                    Effect.provideService(Location.Service, location),
                    Effect.provideService(Global.Service, global),
                  )
                yield* permission.assert({
                  action: "design_edit",
                  resources: ["*"],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                if (input.action === "create") {
                  const mode = IntelligenceEvaluation.mode(yield* intelligence.read())
                  const memory = path.join(global.state, DesignTarget.STATE)
                  const created = yield* DesignProposal.around(
                    yield* proposal(context, input.input.application, input.system, true),
                    Effect.gen(function* () {
                      const target = yield* DesignTarget.choose({
                        requested: input.input,
                        forced: DesignTarget.forced(),
                        mode,
                        classified:
                          mode === "dual"
                            ? yield* intelligence
                                .history(context.sessionID, { operation: "prompt_classification", limit: 5 })
                                .pipe(
                                  Effect.map(DesignTarget.latest),
                                  Effect.orElseSucceed(() => undefined),
                                )
                            : undefined,
                        remembered: yield* Effect.promise(() =>
                          DesignTarget.recall(memory, location.directory).catch(() => undefined),
                        ),
                        detect: sessions.context(context.sessionID).pipe(
                          Effect.orElseSucceed(() => []),
                          Effect.flatMap((messages) =>
                            intelligence.evaluate(
                              DesignTarget.evaluation({
                                sessionID: context.sessionID,
                                requests: messages.flatMap((message) =>
                                  message.type === "user" ? [message.text] : [],
                                ),
                                design: { name: input.input.name, kind: input.input.kind },
                              }),
                            ),
                          ),
                        ),
                        ask: (request) => ask(context, request),
                      })
                      if (target.settled)
                        yield* Effect.promise(() => DesignTarget.remember(memory, location.directory, target))
                      return {
                        document: yield* designs.create(context.sessionID, { ...input.input, ...target }),
                        target,
                      }
                    }),
                  )
                  const chip = DesignTarget.chip(created.value.target, DesignProposal.chip(created.decision))
                  yield* Ref.set(display, {
                    designChip: chip,
                    ...(created.decision.identification
                      ? { designSystem: DesignIdentify.headline(created.decision.identification) }
                      : {}),
                  })
                  return [
                    {
                      ...created.value.document,
                      manifest: [created.value.document.manifest, chip, created.value.target.note, created.report]
                        .filter(Boolean)
                        .join(". "),
                    },
                  ]
                }
                if (input.action === "reopen") return [yield* designs.reopen(context.sessionID, input.id)]
                if (input.action === "refresh") {
                  const current = yield* designs.get(context.sessionID, input.id)
                  const application =
                    path
                      .relative(path.resolve(current.root, "../../../../.."), current.application)
                      .replaceAll("\\", "/") || "."
                  const refreshed = yield* DesignProposal.around(
                    yield* proposal(context, application, undefined, false),
                    designs.refresh(context.sessionID, input.id),
                  )
                  return [
                    {
                      ...refreshed.value,
                      manifest: [refreshed.value.manifest, refreshed.report].filter(Boolean).join(". "),
                    },
                  ]
                }
                return [yield* designs.update(context.sessionID, input.id, input.input)]
              })
              const dependencies =
                typeof output === "string"
                  ? []
                  : yield* Effect.forEach(output, (document) =>
                      Effect.promise(() => DesignBuild.dependencies(document)),
                    )
              const content =
                typeof output === "string"
                  ? output
                  : output
                      .map(
                        (document, index) =>
                          `Design ${document.id}: ${document.name}\n${DesignTarget.describe(document)}\nRoot: ${document.root}\nDependencies: ${dependencies[index]}\nEngine: ${document.engine}\nEntry: ${document.entry}\nCurrent revision: ${document.revision ?? "unpublished"}\n${Design.describeSystem(document.designSystem)}\n${input.action === "list" ? `Design system: ${DesignSystem.summary(document) || "none detected"}` : DesignSystem.describe(document)}\nParams: ${JSON.stringify({ controls: document.controls ?? [], presets: document.presets ?? [] })}\nQuestions: ${document.questions.join("; ")}\nFeedback rounds: ${DesignRounds.summary(document)}${document.manifest ? `\n${document.manifest}` : ""}`,
                      )
                      .join("\n\n")
              return { output, content, metadata: { action: input.action, ...(yield* Ref.get(display)) } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

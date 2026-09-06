import path from "path"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import { DesignManifest } from "@/design/manifest"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { DesignRegistry } from "@/design/registry"
import EXIT_DESCRIPTION from "./design-exit.txt"

export const Parameters = Schema.Struct({})

/**
 * Leaving design mode.
 *
 * Mirrors `plan_exit`, with one difference in what is carried across: a plan exit hands over a
 * document the agent wrote; a design exit hands over a prototype plus the reasoning recorded
 * beside it, and *writes* the plan from that reasoning. The manifest is the whole point — a
 * decision missing from it is a decision the implementation will not know about.
 */
export const DesignExitTool = Tool.define(
  "design_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service
    const fs = yield* FSUtil.Service
    const registry = yield* DesignRegistry.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const root = Session.design(info, instance)
          const prototype = path.relative(instance.worktree, root)

          const manifestFile = DesignManifest.file(root)
          const manifest = (yield* fs.existsSafe(manifestFile))
            ? DesignManifest.parse(yield* Effect.promise(() => Bun.file(manifestFile).text()), info.title)
            : DesignManifest.empty(info.title)

          const planFile = Session.plan(info, instance)
          const plan = path.relative(instance.worktree, planFile)
          const planExists = yield* fs.existsSafe(planFile)
          if (!planExists) {
            yield* fs.ensureDir(path.dirname(planFile))
            yield* Effect.promise(() =>
              Bun.write(
                planFile,
                [
                  `# ${manifest.name}`,
                  "",
                  "## From the design session",
                  "",
                  DesignManifest.summarize(manifest, prototype),
                  "",
                  "## Plan",
                  "",
                  "_Refine this from the prototype and the decisions above._",
                  "",
                ].join("\n"),
              ),
            )
            // Each side points at the other, so someone opening either later finds the rest.
            yield* Effect.promise(() =>
              Bun.write(manifestFile, DesignManifest.serialize({ ...manifest, plan })),
            )
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `The plan was written to ${plan} from the design at ${prototype}. Switch to the plan agent to refine it?`,
                header: "Plan Agent",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to the plan agent and refine the plan" },
                  { label: "No", description: "Stay in design mode and keep working on the prototype" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })
          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          // Leaving is the agent ending the review: the shells say so and go read-only.
          for (const item of yield* registry.forSession(ctx.sessionID)) yield* registry.end(item.id, "agent")

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `The design at ${prototype} is settled and a plan was started at ${plan} from its decisions. Refine the plan.`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Switching to plan agent",
            output: `Plan written to ${plan}. User approved switching to the plan agent. Wait for further instructions.`,
            metadata: { plan, prototype },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as DesignExit from "./design"

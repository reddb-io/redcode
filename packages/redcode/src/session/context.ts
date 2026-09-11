import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Location } from "@reddb-io/redcode-core/location"
import { LocationServiceMap } from "@reddb-io/redcode-core/location-services"
import { Reference } from "@reddb-io/redcode-core/reference"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SystemContext } from "@reddb-io/redcode-core/system-context"
import { SystemContextBuiltIns } from "@reddb-io/redcode-core/system-context/builtins"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Context, DateTime, Effect, Layer, Schema } from "effect"

import type { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"

import { Instruction } from "./instruction"
import { MessageID, PartID } from "./schema"
import type { Session } from "./session"
import { SystemPrompt } from "./system"

/**
 * The legacy loop's durable Baseline System Context: everything in the system prompt that
 * belongs to the Session rather than to one provider turn. A Context Epoch renders it once and
 * reuses the text verbatim; later source changes reach the model as one Mid-Conversation
 * System Message at the next safe boundary.
 */
export interface Interface {
  readonly load: (agent: Agent.Info, session: Session.Info) => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionContext") {}

/** One admitted system message, ready to interleave into legacy history. */
export interface Update {
  readonly timeCreated: DateTime.Utc
  readonly text: string
}

/**
 * Lowers admitted system messages into legacy history as synthetic user messages, each placed
 * after the last message created at or before its admission. The AI SDK rejects mid-conversation
 * `system` messages for some providers and merges adjacent user messages, so a wrapped user
 * message is the portable lowering.
 */
export function interleave(
  messages: SessionV1.WithParts[],
  updates: ReadonlyArray<Update>,
  user: SessionV1.User,
): SessionV1.WithParts[] {
  const lowered = updates.map((update) => ({ at: DateTime.toEpochMillis(update.timeCreated), text: update.text }))
  const before = (at: number) => messages.every((message) => message.info.time.created > at)
  const between = (index: number, at: number) =>
    messages[index].info.time.created <= at && (messages[index + 1]?.info.time.created ?? Infinity) > at
  const lower = (update: { at: number; text: string }): SessionV1.WithParts => {
    const id = MessageID.ascending()
    return {
      info: {
        id,
        sessionID: user.sessionID,
        role: "user",
        time: { created: update.at },
        agent: user.agent,
        model: user.model,
      },
      parts: [
        {
          id: PartID.ascending(),
          messageID: id,
          sessionID: user.sessionID,
          type: "text",
          text: `<system_update>\n${update.text}\n</system_update>`,
          synthetic: true,
        },
      ],
    }
  }
  return [
    ...lowered.filter((update) => before(update.at)).map(lower),
    ...messages.flatMap((message, index) => [
      message,
      ...lowered.filter((update) => between(index, update.at)).map(lower),
    ]),
  ]
}

const ReferenceList = Schema.Array(
  Schema.Struct({ name: Schema.String, path: Schema.String, description: Schema.String }),
)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const instruction = yield* Instruction.Service
    const sys = yield* SystemPrompt.Service
    const locations = yield* LocationServiceMap.Service

    // Every source is observed here and closed over as a value: the epoch reconciles the
    // composed context against its stored snapshot, so a source is present exactly when it has
    // something to say, and a source that could not be observed is unavailable rather than gone.
    const load = Effect.fn("SessionContext.load")(function* (agent: Agent.Info, session: Session.Info) {
      const ctx = yield* InstanceState.context
      const [located, instructions, mcp, skills] = yield* Effect.all(
        [
          Effect.gen(function* () {
            const location = yield* Location.Service
            const reference = yield* Reference.Service
            const references = (yield* reference.list())
              .flatMap((item) =>
                item.description === undefined
                  ? []
                  : [{ name: item.name, path: String(item.path), description: item.description }],
              )
              .toSorted((a, b) => a.name.localeCompare(b.name))
            return { builtins: SystemContextBuiltIns.context(location), references }
          }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) })))),
          instruction.system().pipe(Effect.orDie),
          sys.mcp(agent, session.permission).pipe(Effect.catchDefect(() => Effect.succeed(SystemContext.unavailable))),
          sys.skills(agent),
        ],
        { concurrency: "unbounded" },
      )
      return SystemContext.combine([
        located.builtins,
        ...(located.references.length === 0
          ? []
          : [
              SystemContext.make({
                key: SystemContext.Key.make("redcode/references"),
                codec: Schema.toCodecJson(ReferenceList),
                load: Effect.succeed(located.references),
                baseline: (references) =>
                  [
                    "Project references provide additional directories that can be accessed when relevant.",
                    renderReferences(references),
                  ].join("\n"),
                update: (_previous, references) =>
                  ["The project references are now:", renderReferences(references)].join("\n"),
                removed: () => "Previously listed project references are no longer available.",
              }),
            ]),
        ...(instructions.length === 0
          ? []
          : [
              SystemContext.make({
                key: SystemContext.Key.make("redcode/instructions"),
                codec: Schema.toCodecJson(Schema.Array(Schema.String)),
                load: Effect.succeed(instructions),
                baseline: (current) => current.join("\n"),
                update: (_previous, current) =>
                  ["These instructions replace all previously loaded ambient instructions:", ...current].join("\n"),
                removed: () => "Previously loaded instructions no longer apply.",
              }),
            ]),
        ...(mcp === undefined
          ? []
          : [
              SystemContext.make({
                key: SystemContext.Key.make("redcode/mcp-instructions"),
                codec: Schema.toCodecJson(Schema.String),
                load: Effect.succeed(mcp),
                baseline: (text) => text,
                update: (_previous, text) => ["The MCP server instructions are now:", text].join("\n"),
                removed: () => "Previously listed MCP server instructions no longer apply.",
              }),
            ]),
        ...(skills === undefined
          ? []
          : [
              SystemContext.make({
                key: SystemContext.Key.make("redcode/skill-guidance"),
                codec: Schema.toCodecJson(Schema.String),
                load: Effect.succeed(skills),
                baseline: (text) => text,
                update: (_previous, text) => ["The available skills are now:", text].join("\n"),
                removed: () => "Previously listed skills are no longer available.",
              }),
            ]),
      ])
    })

    return Service.of({ load })
  }),
)

function renderReferences(references: typeof ReferenceList.Type) {
  return [
    "<available_references>",
    ...references.flatMap((reference) => [
      "  <reference>",
      `    <name>${reference.name}</name>`,
      `    <path>${reference.path}</path>`,
      `    <description>${reference.description}</description>`,
      "  </reference>",
    ]),
    "</available_references>",
  ].join("\n")
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Instruction.node, SystemPrompt.node, LocationServiceMap.node],
})

export * as SessionContext from "./context"

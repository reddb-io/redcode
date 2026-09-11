import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Location } from "@reddb-io/redcode-core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@reddb-io/redcode-core/location-services"
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
 * Lowers admitted system messages into legacy history as synthetic user messages. History is
 * anchored by identity on the user message that started the turn: an update admitted during the
 * turn lands after the latest message of the turn created at or before its admission and never
 * ahead of that user message; an update from an earlier turn stays ahead of it. Array order is
 * not chronological after a compaction, so only the anchored range is scanned. The AI SDK rejects
 * mid-conversation `system` messages for some providers and merges adjacent user messages, so a
 * wrapped user message is the portable lowering.
 */
export function interleave(
  messages: SessionV1.WithParts[],
  updates: ReadonlyArray<Update>,
  user: SessionV1.User,
): SessionV1.WithParts[] {
  const anchor = Math.max(
    messages.findIndex((message) => message.info.id === user.id),
    0,
  )
  // The index of the message each update follows; -1 puts it ahead of everything.
  const slot = (at: number) => {
    if (at >= user.time.created) {
      const index = messages.findLastIndex((message, i) => i >= anchor && message.info.time.created <= at)
      return Math.max(index, anchor)
    }
    return messages.findLastIndex((message, i) => i < anchor && message.info.time.created <= at)
  }
  const lowered = updates.map((update) => {
    const at = DateTime.toEpochMillis(update.timeCreated)
    return { slot: slot(at), message: lower(user, at, update.text) }
  })
  return [
    ...lowered.filter((update) => update.slot === -1).map((update) => update.message),
    ...messages.flatMap((message, index) => [
      message,
      ...lowered.filter((update) => update.slot === index).map((update) => update.message),
    ]),
  ]
}

function lower(user: SessionV1.User, at: number, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      sessionID: user.sessionID,
      role: "user",
      time: { created: at },
      agent: user.agent,
      model: user.model,
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: user.sessionID,
        type: "text",
        text: `<system_update>\n${text}\n</system_update>`,
        synthetic: true,
      },
    ],
  }
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
          // `undefined` means no connected server has instructions. MCP status cannot tell a
          // server that is still connecting from a disabled one, and `failed` or `needs_auth` are
          // sticky, so treating any of them as unavailable would block initialization for every
          // turn; the source is absent instead, and a failure in the service dies as it always did.
          sys.mcp(agent, session.permission),
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

// A private map, as every legacy service holds one: the legacy service graph is built without a
// binding for the global `LocationServiceMap.node`, and the unbound node would otherwise be
// resolved from whatever scope happens to enclose the request.
const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Instruction.node, SystemPrompt.node, locationServiceMapNode],
})

export * as SessionContext from "./context"

export * as SessionContext from "./context.js"

import { Intelligence } from "../intelligence.js"
import { IntelligenceEvaluation } from "../intelligence/evaluation.js"
import { IntelligenceClassification } from "../intelligence/classification.js"
import { Model } from "../model.js"
import { Config } from "../config.js"
import { Permission } from "../permission.js"
import { Context, Effect, Layer } from "effect"
import { Agent } from "../agent.js"
import { CodeModeInstructions } from "../codemode/instructions.js"
import { CodeModeTool } from "../codemode/tool.js"
import { Database } from "../database/database.js"
import { DesignContext } from "../design/context.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { InstructionBuiltIns } from "../instructions/builtins.js"
import { Location } from "../location.js"
import { McpInstructions } from "../mcp/instructions.js"
import { McpTool } from "../tool/mcp.js"
import { ReferenceInstructions } from "../reference/instructions.js"
import { SkillInstructions } from "../skill/instructions.js"
import { Tool } from "../tool.js"
import { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { SessionProviderContext } from "./provider-context.js"
import { InstructionEntry } from "./instruction-entry.js"
import { VaultInstructions } from "../vault/instructions.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { RedcodeLegacyInstructions } from "./redcode-legacy-instructions.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionToolOutputPrune } from "./tool-output-prune.js"

export interface Selection {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly instructions: Instructions.List
  readonly tools: Tool.Snapshot
}

export interface Loaded {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly model: SessionRunnerModel.Resolved
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly prune?: SessionToolOutputPrune.Settings
  readonly tools: Tool.Snapshot
}

/**
 * Resolves model-request state in two phases: `select` fixes the Session,
 * agent, instruction sources, and tool snapshot; `load` adds the model and
 * active history for that selection. Auxiliary operations resolve only the
 * capabilities they need; request preparation stays separate from selection.
 */
export interface Interface {
  /** Selects the Session, agent, instructions, and tools used by subsequent work. */
  readonly select: (sessionID: SessionSchema.ID) => Effect.Effect<Selection, AgentNotFoundError>
  /** Resolves the model and active history for that selection. */
  readonly load: (selection: Selection) => Effect.Effect<Loaded, SessionRunnerModel.Error>
  readonly resolveModel: (
    session: SessionSchema.Info,
  ) => Effect.Effect<SessionRunnerModel.Resolved, SessionRunnerModel.Error>
  /** Selects auxiliary title capabilities without instruction or tool preflight. */
  readonly selectTitle: (session: SessionSchema.Info) => Effect.Effect<
    | {
        readonly agent: Agent.Info
        readonly primary: SessionRunnerModel.Resolved | undefined
        readonly selected: SessionRunnerModel.Resolved
      }
    | undefined
  >
  readonly request: SessionModelRequest.Interface
}

/** Location-scoped model-context loader for durable Session Steps. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const intelligence = yield* Intelligence.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const builtins = yield* InstructionBuiltIns.Service
    const model = yield* Model.Service
    const db = (yield* Database.Service).db
    const designs = yield* DesignContext.Service
    const discovery = yield* InstructionDiscovery.Service
    const entries = yield* InstructionEntry.Service
    const location = yield* Location.Service
    const mcpInstructions = yield* McpInstructions.Service
    const mcpTools = yield* McpTool.Service
    const models = yield* SessionRunnerModel.Service
    const request = yield* SessionModelRequest.Service
    const referenceInstructions = yield* ReferenceInstructions.Service
    const skillInstructions = yield* SkillInstructions.Service
    const store = yield* SessionStore.Service
    const registry = yield* Tool.Service
    const vaultInstructions = yield* VaultInstructions.Service

    const resolveModel = (session: SessionSchema.Info) => models.resolve(session, model.available)

    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {
      const agent = yield* agents.get(Agent.ID.make("title"))
      if (!agent) return
      const primary = yield* resolveModel(session).pipe(Effect.orElseSucceed(() => undefined))
      const info = yield* Effect.gen(function* () {
        if (agent.model) return yield* model.get(agent.model.providerID, agent.model.id)
        if (!primary) return
        return yield* model.small(primary.ref.providerID)
      })
      const variant =
        agent.model?.variant ?? MINIMAL_REASONING_VARIANTS.find((id) => info?.variants.some((item) => item.id === id))
      const preferred =
        info &&
        (yield* resolveModel({
          ...session,
          model: Model.Ref.make({
            providerID: info.providerID,
            id: info.id,
            ...(agent.model?.connection || (primary?.ref.providerID === info.providerID && primary.ref.connection)
              ? { connection: agent.model?.connection ?? primary?.ref.connection }
              : {}),
            ...(variant ? { variant } : {}),
          }),
        }).pipe(Effect.orElseSucceed(() => undefined)))
      const selected = preferred ?? primary
      if (!selected) return
      return { agent, primary, selected }
    })

    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt

      yield* mcpTools.flush
      const agent = yield* agents.select(session.agent)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: session.agent ?? agent.id })
      // Discovery and execution must agree on the permissions of the selected agent.
      const permissions = Permission.forAgent(agent.info, session.permissions)
      const codeMode = CodeModeTool.gate(Config.latestExperimental(yield* config.entries(), "code_mode"))
      const tools = yield* registry.snapshot(permissions, { codeMode })
      const settings = yield* intelligence.read(sessionID)
      const user = (yield* store.messages({ sessionID, type: "user", limit: 1 }))[0]
      const classified =
        user &&
        IntelligenceEvaluation.mode(settings) === "dual" &&
        Config.latestExperimental(yield* config.entries(), "reasoning_tool_selection") === true
          ? (yield* intelligence.history(sessionID, {
              operation: "prompt_classification",
              subjectID: user.id,
              limit: 1,
            }))[0]
          : undefined
      const preferred = IntelligenceClassification.toolNamespace(classified)
      const legacy = yield* RedcodeLegacyInstructions.load(db, sessionID)
      if (legacy?.phase === "baseline")
        return { session, agent: { ...agent, info: agent.info }, instructions: legacy.instructions, tools }
      const loaded = yield* Effect.all(
        {
          builtins: builtins.load(sessionID),
          discovery: discovery.load(),
          skills: skillInstructions.load(permissions),
          references: referenceInstructions.load(),
          mcp: mcpInstructions.load(permissions, codeMode !== false),
          entries: entries.load(sessionID),
        },
        { concurrency: "unbounded" },
      )
      return {
        session,
        agent: { ...agent, info: agent.info },
        instructions: Instructions.combine([
          legacy?.instructions ?? Instructions.empty,
          loaded.builtins,
          CodeModeInstructions.make(tools.codeModeCatalog, preferred ? { preferred: [preferred] } : undefined),
          loaded.discovery,
          loaded.skills,
          loaded.references,
          loaded.mcp,
          designs.load(sessionID),
          // Subagents share the Location's project, so they see the same names; only the guide needs a sink.
          vaultInstructions.load(session.projectID, {
            sinks: tools.definitions.some((definition) => VaultInstructions.SINKS.has(definition.name)),
            directory: session.location.directory,
          }),
          loaded.entries,
        ]),
        tools,
      }
    })

    const load = Effect.fn("SessionContext.load")(function* (selection: Selection) {
      const model = yield* resolveModel(selection.session)
      const history = yield* SessionHistory.entriesForRunner(
        db,
        selection.session.id,
        selection.instructions,
        SessionProviderContext.provenance(model) ?? "local",
      )
      return {
        session: selection.session,
        agent: selection.agent,
        model,
        initial: history.initial,
        messages: history.entries.map((entry) => entry.message),
        prune: SessionToolOutputPrune.settings(yield* config.entries()),
        tools: selection.tools,
      }
    })

    return Service.of({ select, load, resolveModel, selectTitle, request })
  }),
)

/** Variant IDs that minimize reasoning output, in preference order. */
const MINIMAL_REASONING_VARIANTS = ["none", "minimal", "low"].map((id) => Model.VariantID.make(id))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Intelligence.node,
    Agent.node,
    Config.node,
    Model.node,
    Database.node,
    DesignContext.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    InstructionEntry.node,
    Location.node,
    McpInstructions.node,
    McpTool.node,
    ReferenceInstructions.node,
    SessionRunnerModel.node,
    SessionModelRequest.node,
    SessionStore.node,
    SkillInstructions.node,
    Tool.node,
    VaultInstructions.node,
  ],
})

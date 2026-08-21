import type { DateTime, Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

export type Mode = "waterfall" | "serial" | "parallel"

export class Definition<
  Type extends string = string,
  Value = unknown,
  HookMode extends Mode = Mode,
> {
  declare readonly Value: Value

  constructor(
    readonly type: Type,
    readonly mode: HookMode,
  ) {}
}

export type Data<D extends Definition> = D["Value"]
export type WaterfallDefinition = Definition<string, unknown, "waterfall">
export type SerialDefinition = Definition<string, unknown, "serial">
export type ParallelDefinition = Definition<string, unknown, "parallel">

export interface Location {
  readonly directory: string
  readonly workspaceID?: string
}

export interface Payload<D extends Definition> {
  readonly id: string
  readonly type: D["type"]
  readonly location: Location
  readonly data: Data<D>
}

export type Next<D extends WaterfallDefinition> = (data?: Data<D>) => Effect.Effect<Data<D>>
export type WaterfallHandler<D extends WaterfallDefinition> = (
  event: Payload<D>,
  next: Next<D>,
) => Effect.Effect<Data<D>> | Data<D>
export type Observer<D extends SerialDefinition | ParallelDefinition> = (
  event: Payload<D>,
) => Effect.Effect<void> | void

export interface Hooks {
  readonly waterfall: <D extends WaterfallDefinition>(
    definition: D,
    callback: WaterfallHandler<D>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly serial: <D extends SerialDefinition>(
    definition: D,
    callback: Observer<D>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly parallel: <D extends ParallelDefinition>(
    definition: D,
    callback: Observer<D>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}

export interface SessionData {
  timestamp: DateTime.Utc
  sessionID: string
}

export interface AgentPreStepData extends SessionData {
  agent: string
  messageID: string
  messages: unknown[]
}

export interface AgentPreSystemData extends SessionData {
  agent: string
  messageID: string
  system: unknown[]
}

export interface ToolPreExecuteData extends SessionData {
  assistantMessageID: string
  callID: string
  tool: string
  args: Record<string, unknown>
}

export interface ToolPostExecuteData extends ToolPreExecuteData {
  output: unknown
  failed: boolean
}

export interface CommandPreExecuteData extends SessionData {
  command: string
  arguments: string
  parts: unknown[]
}

export interface PermissionRequestedData extends SessionData {
  id: string
  permission: string
  patterns: ReadonlyArray<string>
  metadata: Readonly<Record<string, unknown>>
  always: ReadonlyArray<string>
  tool?: {
    messageID: string
    callID: string
  }
}

export interface CompactionPreCompactData extends SessionData {
  context: unknown[]
  prompt?: string
}

export interface TextCompleteData extends SessionData {
  messageID: string
  partID: string
  text: string
}

export interface TurnEndedData extends SessionData {
  finished: boolean
}

const define = <Value>() =>
  <const Type extends string, const HookMode extends Mode>(type: Type, mode: HookMode) =>
    new Definition<Type, Value, HookMode>(type, mode)

export const Operation = {
  Agent: {
    PreStep: define<AgentPreStepData>()("session.next.agent.pre_step", "waterfall"),
    PreSystem: define<AgentPreSystemData>()("session.next.agent.pre_system", "waterfall"),
  },
  Tool: {
    PreExecute: define<ToolPreExecuteData>()("session.next.tool.pre_execute", "waterfall"),
    PostExecute: define<ToolPostExecuteData>()("session.next.tool.post_execute", "parallel"),
  },
  Command: {
    PreExecute: define<CommandPreExecuteData>()("session.next.command.pre_execute", "waterfall"),
  },
  Permission: {
    Requested: define<PermissionRequestedData>()("session.next.permission.requested", "parallel"),
  },
  Compaction: {
    PreCompact: define<CompactionPreCompactData>()("session.next.compaction.pre_compact", "waterfall"),
  },
  Text: {
    Complete: define<TextCompleteData>()("session.next.text.complete", "waterfall"),
  },
  Turn: {
    Started: define<SessionData>()("session.next.turn.started", "parallel"),
    Ended: define<TurnEndedData>()("session.next.turn.ended", "parallel"),
  },
} as const

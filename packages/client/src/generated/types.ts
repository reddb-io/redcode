import type { RedcodeEventEncoded } from "@reddb-io/redcode-protocol/groups/event"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError"

export type DesignError = {
  readonly _tag: "Design.Error"
  readonly code: "not-found" | "conflict" | "invalid" | "unavailable"
  readonly message: string
}
export const isDesignError = (value: unknown): value is DesignError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Design.Error"

export type ProviderNotFoundError = {
  readonly _tag: "ProviderNotFoundError"
  readonly providerID: string
  readonly message: string
}
export const isProviderNotFoundError = (value: unknown): value is ProviderNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type QuestionNotFoundError = {
  readonly _tag: "QuestionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isQuestionNotFoundError = (value: unknown): value is QuestionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "QuestionNotFoundError"

export type ProjectCopyError = {
  readonly name: "ProjectCopyError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isProjectCopyError = (value: unknown): value is ProjectCopyError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "ProjectCopyError"

export type HealthGetOutput = { readonly healthy: true }

export type LocationGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type LocationGetOutput = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: { readonly id: string; readonly directory: string }
}

export type AgentsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type AgentsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
    readonly system?: string
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
    readonly steps?: number
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }>
  }>
}

export type SessionsListInput = {
  readonly workspace?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["workspace"]
  readonly limit?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly directory?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }>
  readonly cursor: { readonly previous?: string; readonly next?: string }
}

export type SessionsCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["id"]
  readonly agent?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["location"]
}

export type SessionsCreateOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsActiveOutput = { readonly data: { readonly [x: string]: { readonly type: "running" } } }["data"]

export type SessionsGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsGoalInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsGoalOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly revision: number
    readonly objective: string
    readonly criteria: ReadonlyArray<string>
    readonly gates: ReadonlyArray<string>
    readonly stopAfter: "design" | "plan" | "build"
    readonly executePlan: boolean
    readonly status: "active" | "waiting" | "paused" | "blocked" | "done"
    readonly reason: string
    readonly turns: { readonly used: number; readonly max: number }
    readonly tokens: number
    readonly reviews: number
    readonly evidence: ReadonlyArray<{ readonly path: string; readonly hash: string; readonly bytes: number }>
    readonly checks: ReadonlyArray<{
      readonly command: string
      readonly exitCode: number
      readonly output: string
      readonly at: number
    }>
    readonly created: number
    readonly updated: number
  } | null
}["data"]

export type SessionsGoalSetInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly objective: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["objective"]
  readonly criteria?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["criteria"]
  readonly gates?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["gates"]
  readonly maxTurns?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["maxTurns"]
  readonly agent?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["agent"]
  readonly model?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["model"]
  readonly stopAfter?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["stopAfter"]
  readonly executePlan?: {
    readonly objective: string
    readonly criteria?: ReadonlyArray<string>
    readonly gates?: ReadonlyArray<string>
    readonly maxTurns?: number
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly stopAfter?: "design" | "plan" | "build"
    readonly executePlan?: boolean
  }["executePlan"]
}

export type SessionsGoalSetOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly revision: number
    readonly objective: string
    readonly criteria: ReadonlyArray<string>
    readonly gates: ReadonlyArray<string>
    readonly stopAfter: "design" | "plan" | "build"
    readonly executePlan: boolean
    readonly status: "active" | "waiting" | "paused" | "blocked" | "done"
    readonly reason: string
    readonly turns: { readonly used: number; readonly max: number }
    readonly tokens: number
    readonly reviews: number
    readonly evidence: ReadonlyArray<{ readonly path: string; readonly hash: string; readonly bytes: number }>
    readonly checks: ReadonlyArray<{
      readonly command: string
      readonly exitCode: number
      readonly output: string
      readonly at: number
    }>
    readonly created: number
    readonly updated: number
  }
}["data"]

export type SessionsGoalControlInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly action: { readonly action: "pause" | "resume" | "drop" | "budget"; readonly maxTurns?: number }["action"]
  readonly maxTurns?: {
    readonly action: "pause" | "resume" | "drop" | "budget"
    readonly maxTurns?: number
  }["maxTurns"]
}

export type SessionsGoalControlOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly revision: number
    readonly objective: string
    readonly criteria: ReadonlyArray<string>
    readonly gates: ReadonlyArray<string>
    readonly stopAfter: "design" | "plan" | "build"
    readonly executePlan: boolean
    readonly status: "active" | "waiting" | "paused" | "blocked" | "done"
    readonly reason: string
    readonly turns: { readonly used: number; readonly max: number }
    readonly tokens: number
    readonly reviews: number
    readonly evidence: ReadonlyArray<{ readonly path: string; readonly hash: string; readonly bytes: number }>
    readonly checks: ReadonlyArray<{
      readonly command: string
      readonly exitCode: number
      readonly output: string
      readonly at: number
    }>
    readonly created: number
    readonly updated: number
  } | null
}["data"]

export type SessionsPlansInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsPlansOutput = {
  readonly data: ReadonlyArray<{
    readonly sessionID: string
    readonly revision: string
    readonly path: string
    readonly content: string
    readonly tasks?: ReadonlyArray<{
      readonly key: string
      readonly content: string
      readonly criterion: string
      readonly quote: string
    }>
    readonly status: "ready" | "approved"
    readonly created: number
  }>
}["data"]

export type SessionsSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionsSwitchAgentOutput = void

export type SessionsSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionsSwitchModelOutput = void

export type SessionsPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly prompt: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["prompt"]
  readonly delivery?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionsPromptOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly mime: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery: "steer" | "queue"
    readonly timeCreated: number
    readonly promotedSeq?: number
  }
}["data"]

export type SessionsCompactInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCompactOutput = void

export type SessionsWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsWaitOutput = void

export type SessionsStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionsStageOutput = {
  readonly data: {
    readonly messageID: string
    readonly partID?: string
    readonly snapshot?: string
    readonly diff?: string
    readonly files?: ReadonlyArray<{
      readonly path: string
      readonly status: "added" | "modified" | "deleted"
      readonly additions: number
      readonly deletions: number
      readonly patch: string
    }>
  }
}["data"]

export type SessionsClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsClearOutput = void

export type SessionsCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCommitOutput = void

export type SessionsContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsContextOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
}["data"]

export type SessionsHistoryInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined; readonly after?: number | undefined }["limit"]
  readonly after?: { readonly limit?: number | undefined; readonly after?: number | undefined }["after"]
}

export type SessionsHistoryOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.agent.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly agent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.model.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.moved"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly location: { readonly directory: string; readonly workspaceID?: string }
          readonly subdirectory?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompt.admitted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.context.updated"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.synthetic"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly callID: string
          readonly command: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly callID: string
          readonly output: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly snapshot?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly finish: string
          readonly cost: number
          readonly tokens: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly snapshot?: string
          readonly files?: ReadonlyArray<string>
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly name: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.called"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly tool: string
          readonly input: { readonly [x: string]: JsonValue }
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.progress"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.success"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
          readonly outputPaths?: ReadonlyArray<string>
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly text: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.retried"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly attempt: number
          readonly error: {
            readonly message: string
            readonly statusCode?: number
            readonly isRetryable: boolean
            readonly responseHeaders?: { readonly [x: string]: string }
            readonly responseBody?: string
            readonly metadata?: { readonly [x: string]: string }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
          readonly text: string
          readonly recent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.staged"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly revert: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
            readonly files?: ReadonlyArray<{
              readonly path: string
              readonly status: "added" | "modified" | "deleted"
              readonly additions: number
              readonly deletions: number
              readonly patch: string
            }>
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.cleared"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.committed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
      }
  >
  readonly hasMore: boolean
}

export type SessionsEventsInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined }["after"]
}

export type SessionsEventsOutput =
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.agent.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly agent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.model.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.moved"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly location: { readonly directory: string; readonly workspaceID?: string }
        readonly subdirectory?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompt.admitted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.context.updated"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.synthetic"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly callID: string
        readonly command: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly callID: string
        readonly output: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly snapshot?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly finish: string
        readonly cost: number
        readonly tokens: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly snapshot?: string
        readonly files?: ReadonlyArray<string>
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly name: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.called"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly tool: string
        readonly input: { readonly [x: string]: unknown }
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.progress"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.success"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
        readonly outputPaths?: ReadonlyArray<string>
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly text: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.retried"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly attempt: number
        readonly error: {
          readonly message: string
          readonly statusCode?: number
          readonly isRetryable: boolean
          readonly responseHeaders?: { readonly [x: string]: string }
          readonly responseBody?: string
          readonly metadata?: { readonly [x: string]: string }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
        readonly text: string
        readonly recent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.staged"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly revert: {
          readonly messageID: string
          readonly partID?: string
          readonly snapshot?: string
          readonly diff?: string
          readonly files?: ReadonlyArray<{
            readonly path: string
            readonly status: "added" | "modified" | "deleted"
            readonly additions: number
            readonly deletions: number
            readonly patch: string
          }>
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.cleared"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.committed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
    }

export type SessionsInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsInterruptOutput = void

export type SessionsMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionsMessageOutput = {
  readonly data:
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
}["data"]

export type DesignsReviewInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type DesignsReviewOutput = Uint8Array

export type DesignsWhiteboardInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type DesignsWhiteboardOutput = Uint8Array

export type DesignsFeedInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined }["after"]
}

export type DesignsFeedOutput =
  | { readonly seq: number; readonly at: number; readonly type: "state"; readonly state: "working" | "idle" }
  | {
      readonly seq: number
      readonly at: number
      readonly type: "user"
      readonly id: string
      readonly text: string
      readonly notes: number
    }
  | { readonly seq: number; readonly at: number; readonly type: "reply"; readonly id: string; readonly text: string }
  | {
      readonly seq: number
      readonly at: number
      readonly type: "tool"
      readonly id: string
      readonly tool: string
      readonly status: "running" | "done" | "failed"
      readonly summary: string
    }
  | {
      readonly seq: number
      readonly at: number
      readonly type: "published"
      readonly design: string
      readonly revision: string
      readonly name: string
    }
  | { readonly seq: number; readonly at: number; readonly type: "agent"; readonly agent: string }

export type DesignsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type DesignsListOutput = ReadonlyArray<{
  readonly controls?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly selector: string
    readonly variant?: string
    readonly fields: ReadonlyArray<
      | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
      | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
      | {
          readonly id: string
          readonly name: string
          readonly type: "number"
          readonly default: number
          readonly min?: number
          readonly max?: number
        }
      | {
          readonly id: string
          readonly name: string
          readonly type: "select"
          readonly default: string
          readonly options: ReadonlyArray<string>
        }
    >
  }>
  readonly presets?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
  }>
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly journey: "new" | "existing"
  readonly engine: "html" | "react" | "solid"
  readonly kind: "screen" | "flow" | "comparison" | "deck"
  readonly root: string
  readonly application: string
  readonly entry: string
  readonly brief: {
    readonly objective: string
    readonly audience: string
    readonly content: string
    readonly constraints: string
    readonly references: ReadonlyArray<string>
  }
  readonly decisions: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly revision?: string
    readonly feedback?: string
  }>
  readonly questions: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<{
    readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly selector: string
    readonly state: "loading" | "empty" | "error" | "populated" | "edge"
    readonly actions: ReadonlyArray<{
      readonly selector: string
      readonly action: "click" | "fill" | "press"
      readonly value?: string
    }>
    readonly notApplicable?: string
  }>
  readonly designSystem: string
  readonly sources: ReadonlyArray<{
    readonly file: string
    readonly hash: string
    readonly observed: number | "Infinity" | "-Infinity" | "NaN"
    readonly authoritative: boolean
    readonly excerpt: string
  }>
  readonly tweaks: { readonly [x: string]: string }
  readonly revision: string | null
  readonly approvedRevision: string | null
  readonly ended: boolean
  readonly updated: number | "Infinity" | "-Infinity" | "NaN"
}>

export type DesignsCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly name: {
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly application?: string
  }["name"]
  readonly journey: {
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly application?: string
  }["journey"]
  readonly engine: {
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly application?: string
  }["engine"]
  readonly kind: {
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly application?: string
  }["kind"]
  readonly application?: {
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly application?: string
  }["application"]
}

export type DesignsCreateOutput = {
  readonly controls?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly selector: string
    readonly variant?: string
    readonly fields: ReadonlyArray<
      | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
      | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
      | {
          readonly id: string
          readonly name: string
          readonly type: "number"
          readonly default: number
          readonly min?: number
          readonly max?: number
        }
      | {
          readonly id: string
          readonly name: string
          readonly type: "select"
          readonly default: string
          readonly options: ReadonlyArray<string>
        }
    >
  }>
  readonly presets?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
  }>
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly journey: "new" | "existing"
  readonly engine: "html" | "react" | "solid"
  readonly kind: "screen" | "flow" | "comparison" | "deck"
  readonly root: string
  readonly application: string
  readonly entry: string
  readonly brief: {
    readonly objective: string
    readonly audience: string
    readonly content: string
    readonly constraints: string
    readonly references: ReadonlyArray<string>
  }
  readonly decisions: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly revision?: string
    readonly feedback?: string
  }>
  readonly questions: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<{
    readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly selector: string
    readonly state: "loading" | "empty" | "error" | "populated" | "edge"
    readonly actions: ReadonlyArray<{
      readonly selector: string
      readonly action: "click" | "fill" | "press"
      readonly value?: string
    }>
    readonly notApplicable?: string
  }>
  readonly designSystem: string
  readonly sources: ReadonlyArray<{
    readonly file: string
    readonly hash: string
    readonly observed: number | "Infinity" | "-Infinity" | "NaN"
    readonly authoritative: boolean
    readonly excerpt: string
  }>
  readonly tweaks: { readonly [x: string]: string }
  readonly revision: string | null
  readonly approvedRevision: string | null
  readonly ended: boolean
  readonly updated: number | "Infinity" | "-Infinity" | "NaN"
}

export type DesignsGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
}

export type DesignsGetOutput = {
  readonly controls?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly selector: string
    readonly variant?: string
    readonly fields: ReadonlyArray<
      | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
      | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
      | {
          readonly id: string
          readonly name: string
          readonly type: "number"
          readonly default: number
          readonly min?: number
          readonly max?: number
        }
      | {
          readonly id: string
          readonly name: string
          readonly type: "select"
          readonly default: string
          readonly options: ReadonlyArray<string>
        }
    >
  }>
  readonly presets?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
  }>
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly journey: "new" | "existing"
  readonly engine: "html" | "react" | "solid"
  readonly kind: "screen" | "flow" | "comparison" | "deck"
  readonly root: string
  readonly application: string
  readonly entry: string
  readonly brief: {
    readonly objective: string
    readonly audience: string
    readonly content: string
    readonly constraints: string
    readonly references: ReadonlyArray<string>
  }
  readonly decisions: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly revision?: string
    readonly feedback?: string
  }>
  readonly questions: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<{
    readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly selector: string
    readonly state: "loading" | "empty" | "error" | "populated" | "edge"
    readonly actions: ReadonlyArray<{
      readonly selector: string
      readonly action: "click" | "fill" | "press"
      readonly value?: string
    }>
    readonly notApplicable?: string
  }>
  readonly designSystem: string
  readonly sources: ReadonlyArray<{
    readonly file: string
    readonly hash: string
    readonly observed: number | "Infinity" | "-Infinity" | "NaN"
    readonly authoritative: boolean
    readonly excerpt: string
  }>
  readonly tweaks: { readonly [x: string]: string }
  readonly revision: string | null
  readonly approvedRevision: string | null
  readonly ended: boolean
  readonly updated: number | "Infinity" | "-Infinity" | "NaN"
}

export type DesignsUpdateInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly controls?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["controls"]
  readonly presets?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["presets"]
  readonly name?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["name"]
  readonly brief?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["brief"]
  readonly decisions?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["decisions"]
  readonly questions?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["questions"]
  readonly scenarios?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["scenarios"]
  readonly designSystem?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["designSystem"]
  readonly entry?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["entry"]
  readonly tweaks?: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly name?: string
    readonly brief?: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions?: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions?: ReadonlyArray<string>
    readonly scenarios?: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem?: string
    readonly entry?: string
    readonly tweaks?: { readonly [x: string]: string }
  }["tweaks"]
}

export type DesignsUpdateOutput = {
  readonly controls?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly selector: string
    readonly variant?: string
    readonly fields: ReadonlyArray<
      | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
      | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
      | {
          readonly id: string
          readonly name: string
          readonly type: "number"
          readonly default: number
          readonly min?: number
          readonly max?: number
        }
      | {
          readonly id: string
          readonly name: string
          readonly type: "select"
          readonly default: string
          readonly options: ReadonlyArray<string>
        }
    >
  }>
  readonly presets?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
  }>
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly journey: "new" | "existing"
  readonly engine: "html" | "react" | "solid"
  readonly kind: "screen" | "flow" | "comparison" | "deck"
  readonly root: string
  readonly application: string
  readonly entry: string
  readonly brief: {
    readonly objective: string
    readonly audience: string
    readonly content: string
    readonly constraints: string
    readonly references: ReadonlyArray<string>
  }
  readonly decisions: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly revision?: string
    readonly feedback?: string
  }>
  readonly questions: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<{
    readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly selector: string
    readonly state: "loading" | "empty" | "error" | "populated" | "edge"
    readonly actions: ReadonlyArray<{
      readonly selector: string
      readonly action: "click" | "fill" | "press"
      readonly value?: string
    }>
    readonly notApplicable?: string
  }>
  readonly designSystem: string
  readonly sources: ReadonlyArray<{
    readonly file: string
    readonly hash: string
    readonly observed: number | "Infinity" | "-Infinity" | "NaN"
    readonly authoritative: boolean
    readonly excerpt: string
  }>
  readonly tweaks: { readonly [x: string]: string }
  readonly revision: string | null
  readonly approvedRevision: string | null
  readonly ended: boolean
  readonly updated: number | "Infinity" | "-Infinity" | "NaN"
}

export type DesignsRevisionsInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
}

export type DesignsRevisionsOutput = ReadonlyArray<{
  readonly id: string
  readonly designID: string
  readonly parent: string | null
  readonly name: string
  readonly created: number | "Infinity" | "-Infinity" | "NaN"
  readonly files: { readonly [x: string]: string }
  readonly document: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly id: string
    readonly sessionID: string
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly root: string
    readonly application: string
    readonly entry: string
    readonly brief: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem: string
    readonly sources: ReadonlyArray<{
      readonly file: string
      readonly hash: string
      readonly observed: number | "Infinity" | "-Infinity" | "NaN"
      readonly authoritative: boolean
      readonly excerpt: string
    }>
    readonly tweaks: { readonly [x: string]: string }
    readonly revision: string | null
    readonly approvedRevision: string | null
    readonly ended: boolean
    readonly updated: number | "Infinity" | "-Infinity" | "NaN"
  }
}>

export type DesignsPreviewInput = {
  readonly sessionID: {
    readonly sessionID: string
    readonly designID: string
    readonly revisionID: string
  }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string; readonly revisionID: string }["designID"]
  readonly revisionID: {
    readonly sessionID: string
    readonly designID: string
    readonly revisionID: string
  }["revisionID"]
}

export type DesignsPreviewOutput = Uint8Array

export type DesignsPublishInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly name: { readonly name: string }["name"]
}

export type DesignsPublishOutput = {
  readonly id: string
  readonly designID: string
  readonly parent: string | null
  readonly name: string
  readonly created: number | "Infinity" | "-Infinity" | "NaN"
  readonly files: { readonly [x: string]: string }
  readonly document: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly id: string
    readonly sessionID: string
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly root: string
    readonly application: string
    readonly entry: string
    readonly brief: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem: string
    readonly sources: ReadonlyArray<{
      readonly file: string
      readonly hash: string
      readonly observed: number | "Infinity" | "-Infinity" | "NaN"
      readonly authoritative: boolean
      readonly excerpt: string
    }>
    readonly tweaks: { readonly [x: string]: string }
    readonly revision: string | null
    readonly approvedRevision: string | null
    readonly ended: boolean
    readonly updated: number | "Infinity" | "-Infinity" | "NaN"
  }
}

export type DesignsRestoreInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly revision: { readonly revision: string }["revision"]
}

export type DesignsRestoreOutput = {
  readonly id: string
  readonly designID: string
  readonly parent: string | null
  readonly name: string
  readonly created: number | "Infinity" | "-Infinity" | "NaN"
  readonly files: { readonly [x: string]: string }
  readonly document: {
    readonly controls?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly selector: string
      readonly variant?: string
      readonly fields: ReadonlyArray<
        | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
        | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
        | {
            readonly id: string
            readonly name: string
            readonly type: "number"
            readonly default: number
            readonly min?: number
            readonly max?: number
          }
        | {
            readonly id: string
            readonly name: string
            readonly type: "select"
            readonly default: string
            readonly options: ReadonlyArray<string>
          }
      >
    }>
    readonly presets?: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    }>
    readonly id: string
    readonly sessionID: string
    readonly name: string
    readonly journey: "new" | "existing"
    readonly engine: "html" | "react" | "solid"
    readonly kind: "screen" | "flow" | "comparison" | "deck"
    readonly root: string
    readonly application: string
    readonly entry: string
    readonly brief: {
      readonly objective: string
      readonly audience: string
      readonly content: string
      readonly constraints: string
      readonly references: ReadonlyArray<string>
    }
    readonly decisions: ReadonlyArray<{
      readonly id: string
      readonly text: string
      readonly revision?: string
      readonly feedback?: string
    }>
    readonly questions: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<{
      readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly id: string
      readonly name: string
      readonly variant?: string
      readonly selector: string
      readonly state: "loading" | "empty" | "error" | "populated" | "edge"
      readonly actions: ReadonlyArray<{
        readonly selector: string
        readonly action: "click" | "fill" | "press"
        readonly value?: string
      }>
      readonly notApplicable?: string
    }>
    readonly designSystem: string
    readonly sources: ReadonlyArray<{
      readonly file: string
      readonly hash: string
      readonly observed: number | "Infinity" | "-Infinity" | "NaN"
      readonly authoritative: boolean
      readonly excerpt: string
    }>
    readonly tweaks: { readonly [x: string]: string }
    readonly revision: string | null
    readonly approvedRevision: string | null
    readonly ended: boolean
    readonly updated: number | "Infinity" | "-Infinity" | "NaN"
  }
}

export type DesignsReopenInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
}

export type DesignsReopenOutput = {
  readonly controls?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly selector: string
    readonly variant?: string
    readonly fields: ReadonlyArray<
      | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
      | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
      | {
          readonly id: string
          readonly name: string
          readonly type: "number"
          readonly default: number
          readonly min?: number
          readonly max?: number
        }
      | {
          readonly id: string
          readonly name: string
          readonly type: "select"
          readonly default: string
          readonly options: ReadonlyArray<string>
        }
    >
  }>
  readonly presets?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
  }>
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly journey: "new" | "existing"
  readonly engine: "html" | "react" | "solid"
  readonly kind: "screen" | "flow" | "comparison" | "deck"
  readonly root: string
  readonly application: string
  readonly entry: string
  readonly brief: {
    readonly objective: string
    readonly audience: string
    readonly content: string
    readonly constraints: string
    readonly references: ReadonlyArray<string>
  }
  readonly decisions: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly revision?: string
    readonly feedback?: string
  }>
  readonly questions: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<{
    readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly selector: string
    readonly state: "loading" | "empty" | "error" | "populated" | "edge"
    readonly actions: ReadonlyArray<{
      readonly selector: string
      readonly action: "click" | "fill" | "press"
      readonly value?: string
    }>
    readonly notApplicable?: string
  }>
  readonly designSystem: string
  readonly sources: ReadonlyArray<{
    readonly file: string
    readonly hash: string
    readonly observed: number | "Infinity" | "-Infinity" | "NaN"
    readonly authoritative: boolean
    readonly excerpt: string
  }>
  readonly tweaks: { readonly [x: string]: string }
  readonly revision: string | null
  readonly approvedRevision: string | null
  readonly ended: boolean
  readonly updated: number | "Infinity" | "-Infinity" | "NaN"
}

export type DesignsRefreshInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
}

export type DesignsRefreshOutput = {
  readonly controls?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly selector: string
    readonly variant?: string
    readonly fields: ReadonlyArray<
      | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
      | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
      | {
          readonly id: string
          readonly name: string
          readonly type: "number"
          readonly default: number
          readonly min?: number
          readonly max?: number
        }
      | {
          readonly id: string
          readonly name: string
          readonly type: "select"
          readonly default: string
          readonly options: ReadonlyArray<string>
        }
    >
  }>
  readonly presets?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
  }>
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly journey: "new" | "existing"
  readonly engine: "html" | "react" | "solid"
  readonly kind: "screen" | "flow" | "comparison" | "deck"
  readonly root: string
  readonly application: string
  readonly entry: string
  readonly brief: {
    readonly objective: string
    readonly audience: string
    readonly content: string
    readonly constraints: string
    readonly references: ReadonlyArray<string>
  }
  readonly decisions: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly revision?: string
    readonly feedback?: string
  }>
  readonly questions: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<{
    readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
    readonly id: string
    readonly name: string
    readonly variant?: string
    readonly selector: string
    readonly state: "loading" | "empty" | "error" | "populated" | "edge"
    readonly actions: ReadonlyArray<{
      readonly selector: string
      readonly action: "click" | "fill" | "press"
      readonly value?: string
    }>
    readonly notApplicable?: string
  }>
  readonly designSystem: string
  readonly sources: ReadonlyArray<{
    readonly file: string
    readonly hash: string
    readonly observed: number | "Infinity" | "-Infinity" | "NaN"
    readonly authoritative: boolean
    readonly excerpt: string
  }>
  readonly tweaks: { readonly [x: string]: string }
  readonly revision: string | null
  readonly approvedRevision: string | null
  readonly ended: boolean
  readonly updated: number | "Infinity" | "-Infinity" | "NaN"
}

export type DesignsFeedbackInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly params?: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["params"]
  readonly id: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["id"]
  readonly revision: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["revision"]
  readonly text: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["text"]
  readonly items: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["items"]
  readonly assets: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["assets"]
  readonly snapshot: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["snapshot"]
  readonly whiteboards?: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["whiteboards"]
  readonly delivery: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["delivery"]
  readonly end: {
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }["end"]
}

export type DesignsFeedbackOutput = { readonly id: string; readonly status: "pending" | "admitted" }

export type DesignsApproveInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly revision: {
    readonly revision: string
    readonly variant?: { readonly id: string; readonly name: string }
  }["revision"]
  readonly variant?: {
    readonly revision: string
    readonly variant?: { readonly id: string; readonly name: string }
  }["variant"]
}

export type DesignsApproveOutput = { readonly plan: string; readonly revision: string }

export type DesignsApprovalInput = {
  readonly sessionID: {
    readonly sessionID: string
    readonly designID: string
    readonly revisionID: string
  }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string; readonly revisionID: string }["designID"]
  readonly revisionID: {
    readonly sessionID: string
    readonly designID: string
    readonly revisionID: string
  }["revisionID"]
}

export type DesignsApprovalOutput = {
  readonly version: 0 | 1
  readonly approvedAt: number | "Infinity" | "-Infinity" | "NaN" | null
  readonly variant: { readonly id: string; readonly name: string } | null
  readonly revision: {
    readonly id: string
    readonly designID: string
    readonly parent: string | null
    readonly name: string
    readonly created: number | "Infinity" | "-Infinity" | "NaN"
    readonly files: { readonly [x: string]: string }
    readonly document: {
      readonly controls?: ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly selector: string
        readonly variant?: string
        readonly fields: ReadonlyArray<
          | { readonly id: string; readonly name: string; readonly type: "text"; readonly default: string }
          | { readonly id: string; readonly name: string; readonly type: "boolean"; readonly default: boolean }
          | {
              readonly id: string
              readonly name: string
              readonly type: "number"
              readonly default: number
              readonly min?: number
              readonly max?: number
            }
          | {
              readonly id: string
              readonly name: string
              readonly type: "select"
              readonly default: string
              readonly options: ReadonlyArray<string>
            }
        >
      }>
      readonly presets?: ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly variant?: string
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      }>
      readonly id: string
      readonly sessionID: string
      readonly name: string
      readonly journey: "new" | "existing"
      readonly engine: "html" | "react" | "solid"
      readonly kind: "screen" | "flow" | "comparison" | "deck"
      readonly root: string
      readonly application: string
      readonly entry: string
      readonly brief: {
        readonly objective: string
        readonly audience: string
        readonly content: string
        readonly constraints: string
        readonly references: ReadonlyArray<string>
      }
      readonly decisions: ReadonlyArray<{
        readonly id: string
        readonly text: string
        readonly revision?: string
        readonly feedback?: string
      }>
      readonly questions: ReadonlyArray<string>
      readonly scenarios: ReadonlyArray<{
        readonly params?: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly id: string
        readonly name: string
        readonly variant?: string
        readonly selector: string
        readonly state: "loading" | "empty" | "error" | "populated" | "edge"
        readonly actions: ReadonlyArray<{
          readonly selector: string
          readonly action: "click" | "fill" | "press"
          readonly value?: string
        }>
        readonly notApplicable?: string
      }>
      readonly designSystem: string
      readonly sources: ReadonlyArray<{
        readonly file: string
        readonly hash: string
        readonly observed: number | "Infinity" | "-Infinity" | "NaN"
        readonly authoritative: boolean
        readonly excerpt: string
      }>
      readonly tweaks: { readonly [x: string]: string }
      readonly revision: string | null
      readonly approvedRevision: string | null
      readonly ended: boolean
      readonly updated: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
  readonly assets: ReadonlyArray<{
    readonly id: string
    readonly designID: string
    readonly name: string
    readonly mime: string
    readonly bytes: number | "Infinity" | "-Infinity" | "NaN"
    readonly hash: string
    readonly source: string
    readonly parent: string | null
    readonly created: number | "Infinity" | "-Infinity" | "NaN"
  }>
  readonly feedback: ReadonlyArray<{
    readonly params?: {
      readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
      readonly preset?: string
      readonly variant?: string
      readonly component?: string
    }
    readonly id: string
    readonly revision: string
    readonly text: string
    readonly items: ReadonlyArray<{
      readonly target: string
      readonly text: string
      readonly params?: {
        readonly values: { readonly [x: string]: { readonly [x: string]: string | number | boolean } }
        readonly preset?: string
        readonly variant?: string
        readonly component?: string
      }
      readonly tag?: string
      readonly elementText?: string
      readonly selectedText?: string
      readonly label?: string
      readonly revision?: string
    }>
    readonly assets: ReadonlyArray<string>
    readonly snapshot: string
    readonly whiteboards?: ReadonlyArray<{ readonly target: string; readonly scene: JsonValue }>
    readonly delivery: "steer" | "queue"
    readonly end: boolean
  }>
  readonly audits: ReadonlyArray<{
    readonly id: string
    readonly result: string | null
    readonly audit: {
      readonly revision: string
      readonly findings: ReadonlyArray<string>
      readonly scenarios: ReadonlyArray<string>
      readonly widths: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
      readonly checks?: ReadonlyArray<{
        readonly rule: string
        readonly severity: "error" | "review"
        readonly selector: string
        readonly evidence: string
        readonly fix: string
        readonly width: number | "Infinity" | "-Infinity" | "NaN"
        readonly variant?: string
        readonly scenario?: string
      }>
      readonly captures?: ReadonlyArray<{
        readonly file: string
        readonly width: number | "Infinity" | "-Infinity" | "NaN"
        readonly variant?: string
        readonly scenario?: string
        readonly fullPage: boolean
      }>
    }
  }>
}

export type DesignsAssetsInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
}

export type DesignsAssetsOutput = ReadonlyArray<{
  readonly id: string
  readonly designID: string
  readonly name: string
  readonly mime: string
  readonly bytes: number
  readonly hash: string
  readonly source: string
  readonly parent: string | null
  readonly created: number
}>

export type DesignsImportAssetInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly name: {
    readonly name: string
    readonly mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "image/gif"
    readonly data: string
    readonly source: string
    readonly parent?: string
  }["name"]
  readonly mime: {
    readonly name: string
    readonly mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "image/gif"
    readonly data: string
    readonly source: string
    readonly parent?: string
  }["mime"]
  readonly data: {
    readonly name: string
    readonly mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "image/gif"
    readonly data: string
    readonly source: string
    readonly parent?: string
  }["data"]
  readonly source: {
    readonly name: string
    readonly mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "image/gif"
    readonly data: string
    readonly source: string
    readonly parent?: string
  }["source"]
  readonly parent?: {
    readonly name: string
    readonly mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "image/gif"
    readonly data: string
    readonly source: string
    readonly parent?: string
  }["parent"]
}

export type DesignsImportAssetOutput = {
  readonly id: string
  readonly designID: string
  readonly name: string
  readonly mime: string
  readonly bytes: number
  readonly hash: string
  readonly source: string
  readonly parent: string | null
  readonly created: number
}

export type DesignsJobsInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
}

export type DesignsJobsOutput = ReadonlyArray<{
  readonly id: string
  readonly designID: string
  readonly input: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly progress: number | "Infinity" | "-Infinity" | "NaN"
  readonly result: string | null
  readonly error: string | null
  readonly created: number | "Infinity" | "-Infinity" | "NaN"
  readonly started?: number | "Infinity" | "-Infinity" | "NaN"
  readonly finished?: number | "Infinity" | "-Infinity" | "NaN"
  readonly audit?: {
    readonly revision: string
    readonly findings: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<string>
    readonly widths: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly checks?: ReadonlyArray<{
      readonly rule: string
      readonly severity: "error" | "review"
      readonly selector: string
      readonly evidence: string
      readonly fix: string
      readonly width: number | "Infinity" | "-Infinity" | "NaN"
      readonly variant?: string
      readonly scenario?: string
    }>
    readonly captures?: ReadonlyArray<{
      readonly file: string
      readonly width: number | "Infinity" | "-Infinity" | "NaN"
      readonly variant?: string
      readonly scenario?: string
      readonly fullPage: boolean
    }>
  }
}>

export type DesignsRenderInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string }["designID"]
  readonly revision: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["revision"]
  readonly format: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["format"]
  readonly implementation?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["implementation"]
  readonly candidate?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["candidate"]
  readonly asset?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["asset"]
  readonly duration?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["duration"]
  readonly fps?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["fps"]
  readonly size?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["size"]
  readonly repeat?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["repeat"]
  readonly background?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["background"]
  readonly transparent?: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }["transparent"]
}

export type DesignsRenderOutput = {
  readonly id: string
  readonly designID: string
  readonly input: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly progress: number | "Infinity" | "-Infinity" | "NaN"
  readonly result: string | null
  readonly error: string | null
  readonly created: number | "Infinity" | "-Infinity" | "NaN"
  readonly started?: number | "Infinity" | "-Infinity" | "NaN"
  readonly finished?: number | "Infinity" | "-Infinity" | "NaN"
  readonly audit?: {
    readonly revision: string
    readonly findings: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<string>
    readonly widths: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly checks?: ReadonlyArray<{
      readonly rule: string
      readonly severity: "error" | "review"
      readonly selector: string
      readonly evidence: string
      readonly fix: string
      readonly width: number | "Infinity" | "-Infinity" | "NaN"
      readonly variant?: string
      readonly scenario?: string
    }>
    readonly captures?: ReadonlyArray<{
      readonly file: string
      readonly width: number | "Infinity" | "-Infinity" | "NaN"
      readonly variant?: string
      readonly scenario?: string
      readonly fullPage: boolean
    }>
  }
}

export type DesignsCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string; readonly jobID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string; readonly jobID: string }["designID"]
  readonly jobID: { readonly sessionID: string; readonly designID: string; readonly jobID: string }["jobID"]
}

export type DesignsCancelOutput = {
  readonly id: string
  readonly designID: string
  readonly input: {
    readonly revision: string
    readonly format: "html" | "gif" | "audit" | "compare"
    readonly implementation?: string
    readonly candidate?: string
    readonly asset?: string
    readonly duration?: number | "Infinity" | "-Infinity" | "NaN"
    readonly fps?: number
    readonly size?: number
    readonly repeat?: number
    readonly background?: string
    readonly transparent?: boolean
  }
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly progress: number | "Infinity" | "-Infinity" | "NaN"
  readonly result: string | null
  readonly error: string | null
  readonly created: number | "Infinity" | "-Infinity" | "NaN"
  readonly started?: number | "Infinity" | "-Infinity" | "NaN"
  readonly finished?: number | "Infinity" | "-Infinity" | "NaN"
  readonly audit?: {
    readonly revision: string
    readonly findings: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<string>
    readonly widths: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly checks?: ReadonlyArray<{
      readonly rule: string
      readonly severity: "error" | "review"
      readonly selector: string
      readonly evidence: string
      readonly fix: string
      readonly width: number | "Infinity" | "-Infinity" | "NaN"
      readonly variant?: string
      readonly scenario?: string
    }>
    readonly captures?: ReadonlyArray<{
      readonly file: string
      readonly width: number | "Infinity" | "-Infinity" | "NaN"
      readonly variant?: string
      readonly scenario?: string
      readonly fullPage: boolean
    }>
  }
}

export type DesignsDownloadInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string; readonly jobID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string; readonly jobID: string }["designID"]
  readonly jobID: { readonly sessionID: string; readonly designID: string; readonly jobID: string }["jobID"]
}

export type DesignsDownloadOutput = Uint8Array

export type DesignsAssetFileInput = {
  readonly sessionID: { readonly sessionID: string; readonly designID: string; readonly assetID: string }["sessionID"]
  readonly designID: { readonly sessionID: string; readonly designID: string; readonly assetID: string }["designID"]
  readonly assetID: { readonly sessionID: string; readonly designID: string; readonly assetID: string }["assetID"]
}

export type DesignsAssetFileOutput = Uint8Array

export type MessagesListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type MessagesListOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type ModelsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly providerID: string
    readonly family?: string
    readonly name: string
    readonly api:
      | {
          readonly id: string
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly id: string
          readonly type: "native"
          readonly url?: string
          readonly settings: { readonly [x: string]: JsonValue }
        }
    readonly capabilities: {
      readonly tools: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
      readonly variant?: string
    }
    readonly variants: ReadonlyArray<{
      readonly id: string
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }>
    readonly time: { readonly released: number }
    readonly cost: ReadonlyArray<{
      readonly tier?: { readonly type: "context"; readonly size: number }
      readonly input: number
      readonly output: number
      readonly cache: { readonly read: number; readonly write: number }
    }>
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled: boolean
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  }>
}

export type ProvidersListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }>
}

export type ProvidersGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }
}

export type IntegrationsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  }>
}

export type IntegrationsGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  } | null
}

export type IntegrationsConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly key: { readonly key: string; readonly label?: string | undefined }["key"]
  readonly label?: { readonly key: string; readonly label?: string | undefined }["label"]
}

export type IntegrationsConnectKeyOutput = void

export type IntegrationsConnectOauthInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["methodID"]
  readonly inputs: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["inputs"]
  readonly label?: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationsConnectOauthOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly attemptID: string
    readonly url: string
    readonly instructions: string
    readonly mode: "auto" | "code"
    readonly time: {
      readonly created: number | "Infinity" | "-Infinity" | "NaN"
      readonly expires: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type IntegrationsAttemptStatusInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptStatusOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data:
    | {
        readonly status: "pending"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "complete"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "failed"
        readonly message: string
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "expired"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
}

export type IntegrationsAttemptCompleteInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationsAttemptCompleteOutput = void

export type IntegrationsAttemptCancelInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptCancelOutput = void

export type CredentialsUpdateInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialsUpdateOutput = void

export type CredentialsRemoveInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CredentialsRemoveOutput = void

export type PermissionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}

export type PermissionsListSavedInput = {
  readonly projectID?: { readonly projectID?: string | undefined }["projectID"]
}

export type PermissionsListSavedOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly projectID: string
    readonly action: string
    readonly resource: string
  }>
}["data"]

export type PermissionsRemoveSavedInput = { readonly id: { readonly id: string }["id"] }

export type PermissionsRemoveSavedOutput = void

export type PermissionsCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["id"]
  readonly action: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["action"]
  readonly resources: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["resources"]
  readonly save?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["save"]
  readonly metadata?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["metadata"]
  readonly source?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["source"]
  readonly agent?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["agent"]
}

export type PermissionsCreateOutput = {
  readonly data: { readonly id: string; readonly effect: "allow" | "deny" | "ask" }
}["data"]

export type PermissionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type PermissionsGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }
}["data"]

export type PermissionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionsReplyOutput = void

export type FilesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["location"]
  readonly path?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["path"]
}

export type FilesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type FilesFindInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly query: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FilesFindOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type CommandsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly template: string
    readonly description?: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly subtask?: boolean
  }>
}

export type SkillsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly slash?: boolean
    readonly location: string
    readonly content: string
  }>
}

export type EventsSubscribeOutput = RedcodeEventEncoded

export type PtysListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }>
}

export type PtysCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly command?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["command"]
  readonly args?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["cwd"]
  readonly title?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["title"]
  readonly env?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["env"]
}

export type PtysCreateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly size?: { readonly rows: number; readonly cols: number }
  }["title"]
  readonly size?: { readonly title?: string; readonly size?: { readonly rows: number; readonly cols: number } }["size"]
}

export type PtysUpdateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysRemoveInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysRemoveOutput = void

export type QuestionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type QuestionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}

export type QuestionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type QuestionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type QuestionsReplyOutput = void

export type QuestionsRejectInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type QuestionsRejectOutput = void

export type ReferencesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ReferencesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly description?: string
    readonly hidden?: boolean
    readonly source:
      | { readonly type: "local"; readonly path: string; readonly description?: string; readonly hidden?: boolean }
      | {
          readonly type: "git"
          readonly repository: string
          readonly branch?: string
          readonly description?: string
          readonly hidden?: boolean
        }
  }>
}

export type ProjectCopiesCreateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly strategy: { readonly strategy: string; readonly directory: string; readonly name?: string }["strategy"]
  readonly directory: { readonly strategy: string; readonly directory: string; readonly name?: string }["directory"]
  readonly name?: { readonly strategy: string; readonly directory: string; readonly name?: string }["name"]
}

export type ProjectCopiesCreateOutput = { readonly directory: string }

export type ProjectCopiesRemoveInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly directory: { readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly directory: string; readonly force: boolean }["force"]
}

export type ProjectCopiesRemoveOutput = void

export type ProjectCopiesRefreshInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCopiesRefreshOutput = void

export type HooksStatusInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type HooksStatusOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly trust: { readonly trusted: boolean; readonly fingerprint: string }
    readonly definitions: ReadonlyArray<{
      readonly id: string
      readonly event:
        | "SessionStart"
        | "UserPromptSubmit"
        | "PreToolUse"
        | "PermissionRequest"
        | "PostToolUse"
        | "PostToolUseFailure"
        | "Notification"
        | "SubagentStart"
        | "SubagentStop"
        | "Stop"
        | "PreCompact"
        | "InstructionsLoaded"
        | "ConfigChange"
        | "WorktreeCreate"
        | "WorktreeRemove"
        | "MessageDisplay"
        | "Setup"
        | "PermissionDenied"
        | "TaskCreated"
        | "TaskCompleted"
        | "TeammateIdle"
        | "DirectoryAdded"
        | "SessionEnd"
        | "Elicitation"
        | "ElicitationResult"
      readonly matcher?: string
      readonly handler:
        | {
            readonly timeout?: number | "Infinity" | "-Infinity" | "NaN"
            readonly statusMessage?: string
            readonly type: "command"
            readonly command: string
            readonly async?: boolean
          }
        | {
            readonly timeout?: number | "Infinity" | "-Infinity" | "NaN"
            readonly statusMessage?: string
            readonly type: "http"
            readonly url: string
            readonly headers?: { readonly [x: string]: string }
          }
        | {
            readonly timeout?: number | "Infinity" | "-Infinity" | "NaN"
            readonly statusMessage?: string
            readonly type: "mcp_tool"
            readonly server: string
            readonly tool: string
            readonly arguments?: { readonly [x: string]: JsonValue }
          }
        | {
            readonly timeout?: number | "Infinity" | "-Infinity" | "NaN"
            readonly statusMessage?: string
            readonly type: "prompt"
            readonly prompt: string
            readonly model?: string
          }
        | {
            readonly timeout?: number | "Infinity" | "-Infinity" | "NaN"
            readonly statusMessage?: string
            readonly type: "agent"
            readonly prompt: string
            readonly agent?: string
            readonly model?: string
          }
      readonly source: string
      readonly support: "active" | "unsupported" | "untrusted"
      readonly reason?: string
    }>
  }
}

export type HooksTrustInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type HooksTrustOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly trusted: boolean; readonly fingerprint: string }
}

export type HooksRevokeInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type HooksRevokeOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly trusted: boolean; readonly fingerprint: string }
}

export type HooksImportInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type HooksImportOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly imported: number; readonly target: string; readonly restart_required: boolean }
}

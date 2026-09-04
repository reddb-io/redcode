export * as SessionEvent from "./session-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { ProviderMetadata, ToolContent } from "./llm"
import { Delivery } from "./session-delivery"
import { Model } from "./model"
import { DateTimeUtcFromMillis, NonNegativeInt, RelativePath } from "./schema"
import { FileAttachment, Prompt } from "./prompt"
import { SessionID } from "./session-id"
import { Location } from "./location"
import { SessionMessage } from "./session-message"
import { Revert } from "./revert"
import { PermissionV1 } from "./permission-v1"

export { FileAttachment }

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "session.next.event.source",
})
export interface Source extends Schema.Schema.Type<typeof Source> {}

const Base = {
  timestamp: DateTimeUtcFromMillis,
  sessionID: SessionID,
}
const PromptFields = {
  ...Base,
  messageID: SessionMessage.ID,
  prompt: Prompt,
  delivery: Delivery,
}

const options = {
  durable: {
    aggregate: "sessionID",
    version: 1,
  },
} as const
const stepSettlementOptions = {
  durable: {
    aggregate: "sessionID",
    version: 2,
  },
} as const

export const UnknownError = SessionMessage.UnknownError
export type UnknownError = SessionMessage.UnknownError

export namespace Agent {
  const AgentBase = {
    ...Base,
    agent: Schema.String,
    messageID: SessionMessage.ID,
  }

  /**
   * Live waterfall fired before each step's model request. V2 plugins return
   * transformed data to rewrite the history that reaches the LLM, or throw to
   * abort the turn. Calling `next()` continues the Location-scoped waterfall;
   * skipping it short-circuits.
   */
  export const PreStep = Event.define({
    type: "session.next.agent.pre_step",
    schema: {
      ...AgentBase,
      messages: Schema.Array(Schema.Unknown),
    },
  })
  export type PreStep = typeof PreStep.Type

  /**
   * Live waterfall fired when assembling the system prompt for a model call.
   * V2 plugins return transformed data to rewrite the system prompt that
   * reaches the LLM, or throw to abort. Calling `next()` continues the
   * Location-scoped waterfall; skipping it short-circuits.
   */
  export const PreSystem = Event.define({
    type: "session.next.agent.pre_system",
    schema: {
      ...AgentBase,
      system: Schema.Array(Schema.Unknown),
    },
  })
  export type PreSystem = typeof PreSystem.Type
}

export const AgentSwitched = Event.define({
  type: "session.next.agent.switched",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    agent: Schema.String,
  },
})
export type AgentSwitched = typeof AgentSwitched.Type

export const ModelSwitched = Event.define({
  type: "session.next.model.switched",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    model: Model.Ref,
  },
})
export type ModelSwitched = typeof ModelSwitched.Type

export const Moved = Event.define({
  type: "session.next.moved",
  ...options,
  schema: {
    ...Base,
    location: Location.Ref,
    subdirectory: RelativePath.pipe(optional),
  },
})
export type Moved = typeof Moved.Type

export const Prompted = Event.define({
  type: "session.next.prompted",
  ...options,
  schema: PromptFields,
})
export type Prompted = typeof Prompted.Type

export const PromptAdmitted = Event.define({
  type: "session.next.prompt.admitted",
  ...options,
  schema: PromptFields,
})
export type PromptAdmitted = typeof PromptAdmitted.Type

export namespace Turn {
  /**
   * Live event fired once per turn, before any step runs. Marks the start of
   * the agent loop processing a single user prompt (which may span multiple
   * steps). Observation only — plugins use this for telemetry / turn-level
   * bookkeeping.
   */
  export const Started = Event.define({
    type: "session.next.turn.started",
    schema: Base,
  })
  export type Started = typeof Started.Type

  /**
   * Live event fired once when a turn ends (loop exit, before the last
   * assistant is returned). Marks the natural boundary for telemetry and
   * for any plugin that wants to run a side effect at the end of a turn.
   */
  export const Ended = Event.define({
    type: "session.next.turn.ended",
    schema: { ...Base, finished: Schema.Boolean },
  })
  export type Ended = typeof Ended.Type
}

export namespace Guard {
  /**
   * One of the turn's guards intervened.
   *
   * Live and observational: the guard has already acted by the time this is published, and the
   * action itself reaches the user through the transcript. This exists so the intervention can be
   * counted — thresholds were argued into place, and only evidence can argue them out.
   */
  export const Tripped = Event.define({
    type: "session.next.guard.tripped",
    schema: {
      ...Base,
      /** Which guard: stall, tool_timeout, loop, steps, aux. */
      guard: Schema.String,
      /** What it did: warn (said so, changed nothing), correct (answered the model), stop (ended it). */
      action: Schema.String,
      /** The tool, phase, or call it acted on, when there is one. */
      subject: optional(Schema.String),
      detail: Schema.String,
    },
  })
  export type Tripped = typeof Tripped.Type
}

export const ContextUpdated = Event.define({
  type: "session.next.context.updated",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    text: Schema.String,
  },
})
export type ContextUpdated = typeof ContextUpdated.Type

export const Synthetic = Event.define({
  type: "session.next.synthetic",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    text: Schema.String,
  },
})
export type Synthetic = typeof Synthetic.Type

export namespace Shell {
  export const Started = Event.define({
    type: "session.next.shell.started",
    ...options,
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      callID: Schema.String,
      command: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.define({
    type: "session.next.shell.ended",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      output: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Step {
  export const Started = Event.define({
    type: "session.next.step.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      agent: Schema.String,
      model: Model.Ref,
      snapshot: Schema.String.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.define({
    type: "session.next.step.ended",
    ...stepSettlementOptions,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      finish: Schema.String,
      cost: Schema.Finite,
      tokens: Schema.Struct({
        input: Schema.Finite,
        output: Schema.Finite,
        reasoning: Schema.Finite,
        cache: Schema.Struct({
          read: Schema.Finite,
          write: Schema.Finite,
        }),
      }),
      snapshot: Schema.String.pipe(optional),
      files: Schema.Array(RelativePath).pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = Event.define({
    type: "session.next.step.failed",
    ...stepSettlementOptions,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      error: UnknownError,
    },
  })
  export type Failed = typeof Failed.Type
}

export namespace Text {
  export const Started = Event.define({
    type: "session.next.text.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
  export const Delta = Event.define({
    type: "session.next.text.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.define({
    type: "session.next.text.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
      text: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type

  /**
   * Live waterfall fired when a text part's stream completes, before the
   * final value is persisted. V2 plugins register through
   * `ctx.hook.waterfall` to transform the final text or throw to veto.
   */
  export const Complete = Event.define({
    type: "session.next.text.complete",
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      partID: Schema.String,
      text: Schema.String,
    },
  })
  export type Complete = typeof Complete.Type
}

export namespace Reasoning {
  export const Started = Event.define({
    type: "session.next.reasoning.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Reasoning.Ended is the replayable full-value boundary.
  export const Delta = Event.define({
    type: "session.next.reasoning.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.define({
    type: "session.next.reasoning.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
      text: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Tool {
  const ToolBase = {
    ...Base,
    assistantMessageID: SessionMessage.ID,
    callID: Schema.String,
  }

  /**
   * Live waterfall fired immediately before a tool's `execute` runs.
   * V2 plugins register through `ctx.hook.waterfall` to transform the call
   * input or throw to veto before execution.
   */
  export const PreExecute = Event.define({
    type: "session.next.tool.pre_execute",
    schema: {
      ...ToolBase,
      tool: Schema.String,
      args: Schema.Record(Schema.String, Schema.Unknown),
    },
  })
  export type PreExecute = typeof PreExecute.Type

  /**
   * Live event fired after a tool's `execute` completes (success or failure).
   * Listeners observe the call input and the output; no veto (the call already
   * happened). This is the V2 replacement for the legacy V1 `tool.execute.after`
   * hook and dispatches Location-scoped observers in parallel.
   */
  export const PostExecute = Event.define({
    type: "session.next.tool.post_execute",
    schema: {
      ...ToolBase,
      tool: Schema.String,
      args: Schema.Record(Schema.String, Schema.Unknown),
      output: Schema.Unknown,
      failed: Schema.Boolean,
    },
  })
  export type PostExecute = typeof PostExecute.Type

  export namespace Input {
    export const Started = Event.define({
      type: "session.next.tool.input.started",
      ...options,
      schema: {
        ...ToolBase,
        name: Schema.String,
      },
    })
    export type Started = typeof Started.Type

    // Stream fragments are live-only; Input.Ended is the replayable raw-input boundary.
    export const Delta = Event.define({
      type: "session.next.tool.input.delta",
      schema: {
        ...ToolBase,
        delta: Schema.String,
      },
    })
    export type Delta = typeof Delta.Type

    export const Ended = Event.define({
      type: "session.next.tool.input.ended",
      ...options,
      schema: {
        ...ToolBase,
        text: Schema.String,
      },
    })
    export type Ended = typeof Ended.Type
  }

  export const Called = Event.define({
    type: "session.next.tool.called",
    ...options,
    schema: {
      ...ToolBase,
      tool: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Called = typeof Called.Type

  /**
   * Replayable bounded running-tool state. Tools should checkpoint semantic
   * transitions or at a bounded cadence, not persist every stdout/stderr chunk.
   */
  export const Progress = Event.define({
    type: "session.next.tool.progress",
    ...options,
    schema: {
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
    },
  })
  export type Progress = typeof Progress.Type

  export const Success = Event.define({
    type: "session.next.tool.success",
    ...options,
    schema: {
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
      outputPaths: Schema.Array(Schema.String).pipe(optional),
      result: Schema.Unknown.pipe(optional),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Success = typeof Success.Type

  export const Failed = Event.define({
    type: "session.next.tool.failed",
    ...options,
    schema: {
      ...ToolBase,
      error: UnknownError,
      result: Schema.Unknown.pipe(optional),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Failed = typeof Failed.Type
}

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: Schema.Finite.pipe(optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(optional),
  responseBody: Schema.String.pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(optional),
}).annotate({
  identifier: "session.next.retry_error",
})
export interface RetryError extends Schema.Schema.Type<typeof RetryError> {}

export namespace Permission {
  /**
   * Live event fired when a permission request is queued for the user. Plugins
   * observe (no veto — the ask already happened). This is the V2 surface for
   * the legacy V1 `permission.ask` hook; V2 plugins register a parallel
   * observer through `ctx.hook.parallel`.
   */
  export const Requested = Event.define({
    type: "session.next.permission.requested",
    schema: {
      ...Base,
      ...PermissionV1.Request.fields,
    },
  })
  export type Requested = typeof Requested.Type
}

export namespace Command {
  const CommandBase = {
    ...Base,
    command: Schema.String,
  }

  /**
   * Live waterfall fired before a slash command runs. V2 plugins return
   * transformed data to rewrite the prompt payload, or throw to veto through
   * `ctx.hook.waterfall`.
   */
  export const PreExecute = Event.define({
    type: "session.next.command.pre_execute",
    schema: {
      ...CommandBase,
      arguments: Schema.String,
      parts: Schema.Array(Schema.Unknown),
    },
  })
  export type PreExecute = typeof PreExecute.Type
}

export const Retried = Event.define({
  type: "session.next.retried",
  ...options,
  schema: {
    ...Base,
    attempt: Schema.Finite,
    error: RetryError,
  },
})
export type Retried = typeof Retried.Type

export namespace Compaction {
  export const Started = Event.define({
    type: "session.next.compaction.started",
    ...options,
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
    },
  })
  export type Started = typeof Started.Type

  /**
   * Live waterfall fired right before a compaction runs. Listeners return
   * `{ context, prompt }` to inject context or replace the compaction prompt.
   * V2 plugins register through `ctx.hook.waterfall` and use `next()` to
   * compose transformations in registration order.
   */
  export const PreCompact = Event.define({
    type: "session.next.compaction.pre_compact",
    schema: {
      ...Base,
      context: Schema.Array(Schema.Unknown),
      prompt: Schema.optional(Schema.String),
    },
  })
  export type PreCompact = typeof PreCompact.Type

  export const Delta = Event.define({
    type: "session.next.compaction.delta",
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      text: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.define({
    type: "session.next.compaction.ended",
    ...options,
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      reason: Started.data.fields.reason,
      text: Schema.String,
      recent: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace RevertEvent {
  export const Staged = Event.define({
    type: "session.next.revert.staged",
    ...options,
    schema: { ...Base, revert: Revert.State },
  })
  export const Cleared = Event.define({ type: "session.next.revert.cleared", ...options, schema: Base })
  export const Committed = Event.define({
    type: "session.next.revert.committed",
    ...options,
    schema: { ...Base, messageID: SessionMessage.ID },
  })
}

export const DurableDefinitions = Event.inventory(
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Ended,
  Tool.Input.Started,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Reasoning.Started,
  Reasoning.Ended,
  Retried,
  Compaction.Started,
  Compaction.Ended,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed,
)

export const Definitions = Event.inventory(
  Guard.Tripped,
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Delta,
  Text.Ended,
  Reasoning.Started,
  Reasoning.Delta,
  Reasoning.Ended,
  Tool.Input.Started,
  Tool.Input.Delta,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Retried,
  Compaction.Started,
  Compaction.Delta,
  Compaction.Ended,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed,
)

export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" })
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionDurableEvent" })
export type DurableEvent = typeof Durable.Type

export const All = Schema.Union(Definitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
export type Event = typeof All.Type
export type Type = Event["type"]

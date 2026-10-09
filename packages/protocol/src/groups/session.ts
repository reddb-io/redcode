import { SessionMessage } from "@opencode/schema/session-message"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { PromptInput } from "@opencode/schema/prompt-input"
import { Session } from "@opencode/schema/session"
import { Credential } from "@opencode/schema/credential"
import { SessionStats } from "@opencode/schema/session-stats"
import { UsageMirror } from "@opencode/schema/usage-mirror"
import { Monitor } from "@opencode/schema/monitor"
import { SessionTodo } from "@opencode/schema/session-todo"
import { SessionGoal } from "@opencode/schema/session-goal"
import { SessionBudget } from "@opencode/schema/session-budget"
import { Design } from "@opencode/schema/design"
import { InstructionEntry } from "@opencode/schema/instruction-entry"
import { Project } from "@opencode/schema/project"
import {
  AbsolutePath,
  DateTimeUtcFromMillis,
  NonNegativeInt,
  PositiveInt,
  RelativePath,
  statics,
} from "@opencode/schema/schema"
import { Event } from "@opencode/schema/event"
import { Context, Effect, Encoding, Result, Schema, SchemaGetter, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ConflictError,
  LocationNotFoundError,
  DesignNotFoundError,
  CommandExecutionError,
  CommandNotFoundError,
  FormAlreadySettledError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InvalidCursorError,
  InvalidRequestError,
  MessageNotFoundError,
  MonitorNotFoundError,
  ServiceUnavailableError,
  SessionBusyError,
  SessionNotFoundError,
  SkillNotFoundError,
  UnknownError,
} from "../errors.js"
import { Agent } from "@opencode/schema/agent"
import { Skill } from "@opencode/schema/skill"
import { Model } from "@opencode/schema/model"
import { Permission } from "@opencode/schema/permission"
import { Location } from "@opencode/schema/location"
import { SessionEvent } from "@opencode/schema/session-event"
import { EventLog } from "@opencode/schema/event-log"
import { FileDiff } from "@opencode/schema/file-diff"
import { Form } from "@opencode/schema/form"
import { PublicSessionMessage } from "./message.js"

// Monitor creation validates executable regex and JSON-path predicates in Core. Read APIs
// expose the already-validated values without shipping those nonportable predicates to clients.
const PublicMonitorInfo = Schema.Struct({
  ...Monitor.Info.fields,
  options: Schema.Struct({
    ...Monitor.Options.fields,
    success_regex: Schema.optional(Schema.String),
    failure_regex: Schema.optional(Schema.String),
  }),
  probe: Schema.optional(
    Schema.Union([
      Schema.Struct({
        ...Monitor.HttpProbe.fields,
        json_path: Schema.optional(Schema.String),
        regex: Schema.optional(Schema.String),
      }),
      Monitor.FileProbe,
      Monitor.ProcessProbe,
    ]),
  ),
}).annotate({ identifier: "Monitor.PublicInfo" })

const ParentIDFilter = Schema.Union([
  Session.ID,
  Schema.Null.pipe(
    Schema.encodeTo(Schema.Literal("null"), {
      decode: SchemaGetter.transform(() => null),
      encode: SchemaGetter.transform(() => "null" as const),
    }),
  ),
]).annotate({
  description: "Filter by parent session. Use null to return only root sessions.",
})

const SessionsQueryFields = {
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional).annotate({
    description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  search: Schema.optional(Schema.String),
  parentID: ParentIDFilter.pipe(Schema.optional),
}

const SessionsDirectoryQuery = Schema.Struct({
  ...SessionsQueryFields,
  directory: AbsolutePath,
})

const SessionsProjectQuery = Schema.Struct({
  ...SessionsQueryFields,
  project: Project.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const SessionsAllQuery = Schema.Struct(SessionsQueryFields)

const withCursor = <Fields extends Schema.Struct.Fields>(schema: Schema.Struct<Fields>) =>
  schema.mapFields((fields) => ({
    ...Struct.omit(fields, ["limit"]),
    anchor: Session.ListAnchor,
  }))

const SessionsCursorInput = Schema.Union([
  withCursor(SessionsDirectoryQuery),
  withCursor(SessionsProjectQuery),
  withCursor(SessionsAllQuery),
])
const SessionsCursorJson = Schema.fromJsonString(SessionsCursorInput)
const encodeSessionsCursor = Schema.encodeSync(SessionsCursorJson)
const decodeSessionsCursor = Schema.decodeUnknownEffect(SessionsCursorJson)
const invalidCursor = "Invalid cursor" as const

export const SessionsCursor = Schema.String.pipe(
  Schema.brand("SessionsCursor"),
  statics((schema) => {
    const make = schema.make.bind(schema)
    return {
      make: (input: typeof SessionsCursorInput.Type) => make(Encoding.encodeBase64Url(encodeSessionsCursor(input))),
      parse: (input: string) =>
        Effect.suspend(() => {
          const result = Encoding.decodeBase64UrlString(input)
          return Result.isFailure(result)
            ? Effect.fail(invalidCursor)
            : decodeSessionsCursor(result.success).pipe(Effect.mapError(() => invalidCursor))
        }),
    }
  }),
)
export type SessionsCursor = typeof SessionsCursor.Type

const SessionActive = Schema.Struct({
  type: Schema.Literal("running"),
}).annotate({ identifier: "SessionActive" })

const PublicSessionInfo = Schema.Struct({
  ...Struct.omit(Session.Info.fields, ["location"]),
  location: Location.PublicRef,
}).annotate({ identifier: "Session.Info" })

const PublicSessionTransfer = Schema.Struct({
  info: PublicSessionInfo,
  messages: Schema.Array(PublicSessionMessage),
}).annotate({ identifier: "SessionTransfer.Data" })

const PublicMovePayload = Schema.Struct({
  ...Struct.omit(SessionInbox.MovePayload.fields, ["location"]),
  location: Location.PublicRef,
}).annotate({ identifier: "Session.Inbox.MovePayload" })

const PublicMove = Schema.Struct({
  ...Struct.omit(SessionInbox.Move.fields, ["payload"]),
  payload: PublicMovePayload,
}).annotate({ identifier: "Session.Inbox.Move" })

const PublicInboxInfo = Schema.Union([
  SessionInbox.User,
  SessionInbox.Synthetic,
  SessionInbox.Compaction,
  PublicMove,
]).annotate({ identifier: "Session.Inbox.Info" })

const FormCreatePayload = Schema.Struct({
  id: Form.ID.pipe(Schema.optional),
  title: Form.Info.fields.title,
  metadata: Form.Info.fields.metadata,
  fields: Form.Info.fields.fields,
}).annotate({ identifier: "Form.CreatePayload" })

const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

const SessionsQueryCursor = SessionsCursor.annotate({
  description: "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.",
})

export const SessionsQuery = Schema.Struct({
  ...SessionsQueryFields,
  directory: AbsolutePath.pipe(Schema.optional),
  project: Project.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
  cursor: SessionsQueryCursor.pipe(Schema.optional),
}).annotate({ identifier: "SessionsQuery" })

export const RpcSessionListInput = Schema.Struct({
  directory: AbsolutePath.pipe(Schema.optional),
  project: Project.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  parentID: Schema.NullOr(Session.ID).pipe(Schema.optional),
  cursor: SessionsCursor.pipe(Schema.optional),
})

export const SessionsResponse = Schema.Struct({
  data: Schema.Array(PublicSessionInfo),
  cursor: Schema.Struct({
    previous: SessionsCursor.pipe(Schema.optional),
    next: SessionsCursor.pipe(Schema.optional),
  }),
}).annotate({ identifier: "SessionsResponse" })

export const ActiveSessionsResponse = Schema.Struct({
  data: Schema.Record(Session.ID, SessionActive),
}).annotate({ identifier: "ActiveSessionsResponse" })

export const makeSessionGroup = <I extends HttpApiMiddleware.AnyId, S, FormI extends HttpApiMiddleware.AnyId, FormS>(
  sessionLocationMiddleware: Context.Key<I, S>,
  formLocationMiddleware: Context.Key<FormI, FormS>,
) =>
  HttpApiGroup.make("server.session")
    .add(
      HttpApiEndpoint.get("session.design.conversations", "/api/experimental/design/conversations", {
        query: { directory: AbsolutePath },
        success: Schema.Array(Design.Conversation),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.session.design.conversations",
          summary: "List Design conversations",
          description: "List Design sessions and their review state in a directory, newest first.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.list", "/api/session", {
        query: SessionsQuery,
        success: SessionsResponse,
        error: [InvalidCursorError, InvalidRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.list",
          summary: "List sessions",
          description:
            "Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.stats", "/api/experimental/session/stats", {
        query: Schema.Struct({
          from: Schema.NumberFromString.pipe(Schema.optional),
          to: Schema.NumberFromString.pipe(Schema.optional),
          project: Project.ID.pipe(Schema.optional),
          timezone: Schema.String.pipe(Schema.optional),
          tools: SessionStats.ToolMode.pipe(Schema.optional),
        }),
        success: Schema.Struct({ data: SessionStats.Info }),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.session.stats",
          summary: "Get session statistics",
          description: "Aggregate local session activity, usage, and tool reliability for a time range.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.usage.backfill", "/api/experimental/session/usage/backfill", {
        success: Schema.Struct({ data: UsageMirror.Backfill }),
        error: ServiceUnavailableError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.session.usage.backfill",
          summary: "Backfill the local usage sidecar",
          description: "Copy V2 assistant usage into the legacy-format local usage database.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.create", "/api/session", {
        payload: Schema.Struct({
          id: Session.ID.pipe(Schema.optional),
          title: Schema.String.pipe(Schema.optional),
          agent: Agent.ID.pipe(Schema.optional),
          model: Model.Ref.pipe(Schema.optional),
          location: Location.PublicRef.pipe(Schema.optional),
          metadata: Session.Metadata.pipe(Schema.optional),
          permissions: Permission.Ruleset.pipe(Schema.optional),
        }),
        success: Schema.Struct({ data: PublicSessionInfo }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.create",
          summary: "Create session",
          description: "Create a session at the requested location.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.import", "/api/experimental/session/import", {
        payload: Schema.Struct({
          ...PublicSessionTransfer.fields,
          location: Location.PublicRef.pipe(Schema.optional),
        }),
        success: Schema.Struct({ data: PublicSessionInfo }),
        error: [ConflictError, SessionNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.session.import",
          summary: "Import session",
          description:
            "Import a projected session transcript at the requested location. If parentID is supplied, the parent session must already exist; import parents before children.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.export", "/api/experimental/session/:sessionID/export", {
        params: { sessionID: Session.ID },
        query: Schema.Struct({ sanitize: BooleanFromString.pipe(Schema.optional) }),
        success: Schema.Struct({ data: PublicSessionTransfer }),
        error: [SessionNotFoundError, UnknownError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.session.export",
          summary: "Export session",
          description: "Export a complete projected session transcript.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.active", "/api/session/active", {
        success: ActiveSessionsResponse,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.active",
          summary: "List active sessions",
          description:
            "Retrieve foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.get", "/api/session/:sessionID", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: PublicSessionInfo }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.get",
          summary: "Get session",
          description: "Retrieve a session by ID.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.share", "/api/session/:sessionID/share", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: PublicSessionInfo }),
        error: [SessionNotFoundError, InvalidRequestError, ServiceUnavailableError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.share",
          summary: "Share session",
          description: "Create or synchronize a public link for a session.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.delete("session.unshare", "/api/session/:sessionID/share", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: PublicSessionInfo }),
        error: [SessionNotFoundError, InvalidRequestError, ServiceUnavailableError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.unshare",
          summary: "Unshare session",
          description: "Revoke the public link for a session.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.rebindShare", "/api/session/:sessionID/share/rebind", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ credentialID: Credential.ID, orgID: Schema.String }),
        success: Schema.Struct({ data: PublicSessionInfo }),
        error: [SessionNotFoundError, InvalidRequestError, ServiceUnavailableError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.rebindShare",
          summary: "Restore imported Console share provenance",
          description:
            "Associate an imported share with its Console credential and organization, then verify it by synchronizing.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.monitor.list", "/api/session/:sessionID/monitor", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(PublicMonitorInfo) }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.monitor.list",
          summary: "List session monitors",
          description:
            "Manage monitors belonging to this session. Cancellation stops local observation; external jobs keep running.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.monitor.get", "/api/session/:sessionID/monitor/:monitorID", {
        params: { sessionID: Session.ID, monitorID: Schema.String },
        success: Schema.Struct({ data: PublicMonitorInfo }),
        error: [SessionNotFoundError, MonitorNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.monitor.get",
          summary: "Get session monitor",
          description:
            "Manage monitors belonging to this session. Cancellation stops local observation; external jobs keep running.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.monitor.cancel", "/api/session/:sessionID/monitor/:monitorID/cancel", {
        params: { sessionID: Session.ID, monitorID: Schema.String },
        success: Schema.Struct({ data: PublicMonitorInfo }),
        error: [SessionNotFoundError, MonitorNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.monitor.cancel",
          summary: "Stop local monitoring",
          description:
            "Manage monitors belonging to this session. Cancellation stops local observation; external jobs keep running.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.todo.list", "/api/session/:sessionID/todo", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(SessionTodo.Info) }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.todo.list",
          summary: "List session tasks",
          description: "Read persisted Redcode tasks, including blockers and completion evidence.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.goal.get", "/api/experimental/session/:sessionID/goal", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.NullOr(SessionGoal.Info) }),
        error: [SessionNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.goal.get",
            summary: "Get session goal",
            description: "Retrieve the goal and its current step budget, evidence, and review state.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.goal.start", "/api/experimental/session/:sessionID/goal", {
        params: { sessionID: Session.ID },
        payload: SessionGoal.Input,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.goal.start",
            summary: "Start session goal",
            description:
              "Create a goal and admit an instruction to start working on it. An active goal must be paused before replacement.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.goal.control", "/api/experimental/session/:sessionID/goal/control", {
        params: { sessionID: Session.ID },
        payload: SessionGoal.Control,
        success: Schema.Struct({ data: Schema.NullOr(SessionGoal.Info) }),
        error: [SessionNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.goal.control",
            summary: "Control session goal",
            description:
              "Pause, resume, drop, or change the step, cost, and token budget of the current goal. Pause and drop interrupt local execution; resume admits work.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.goal.command", "/api/experimental/session/:sessionID/goal/command", {
        params: { sessionID: Session.ID },
        payload: SessionGoal.CommandInput,
        success: Schema.Struct({ data: SessionGoal.CommandReading }),
        error: [SessionNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.goal.command",
            summary: "Read a /goal command",
            description:
              "Read what the user typed after /goal without acting on it. An explicit subcommand (set, pause, resume, drop, budget, status) resolves directly. Other text is read by System One in dual reasoning; a reading that would drop or replace an unfinished goal below 0.85 confidence, or any other reading below 0.7, returns options to ask the user instead of an action. Without a reading the text is a new goal only when no goal is unfinished.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.budget.get", "/api/session/:sessionID/budget", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: SessionBudget.View }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.budget.get",
          summary: "Get session budget",
          description:
            "Read the cost and token limits in force and total provider usage by this session and its children.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.patch("session.budget.update", "/api/session/:sessionID/budget", {
        params: { sessionID: Session.ID },
        payload: SessionBudget.Update,
        success: Schema.Struct({ data: SessionBudget.View }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.budget.update",
          summary: "Set session budget",
          description:
            "Set or clear cost and token limits for this session. Omitted fields stay unchanged; null removes a limit.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.design.feed", "/api/experimental/session/:sessionID/design/feed", {
        params: { sessionID: Session.ID },
        query: { after: Schema.NumberFromString.pipe(Schema.decodeTo(Event.Seq), Schema.optional) },
        success: HttpApiSchema.StreamSse({ data: Design.FeedEvent }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.session.design.feed",
          summary: "Follow Design review conversation",
          description: "Replay the session's durable conversation as Design review events and continue live.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.design.list", "/api/experimental/session/:sessionID/design", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(Design.Info) }),
        error: [SessionNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.list",
            summary: "List session designs",
            description: "Read Design documents in this session, including documents imported from Redcode V1.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.design.create", "/api/experimental/session/:sessionID/design", {
        params: { sessionID: Session.ID },
        payload: Design.Create,
        success: Schema.Struct({ data: Design.Info }),
        error: [SessionNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.create",
            summary: "Create Design document",
            description:
              "Create an isolated Design prototype for this session and discover its application design system.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.design.get", "/api/experimental/session/:sessionID/design/:designID", {
        params: { sessionID: Session.ID, designID: Design.ID },
        success: Schema.Struct({ data: Design.Info }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.get",
            summary: "Get Design document",
            description: "Read one Design document from this session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.design.jobs", "/api/experimental/session/:sessionID/design/:designID/jobs", {
        params: { sessionID: Session.ID, designID: Design.ID },
        success: Schema.Struct({ data: Schema.Array(Design.Job) }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.jobs",
            summary: "List Design jobs",
            description: "Read durable render and verification jobs for a Design document.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.patch("session.design.update", "/api/experimental/session/:sessionID/design/:designID", {
        params: { sessionID: Session.ID, designID: Design.ID },
        payload: Design.Update,
        success: Schema.Struct({ data: Design.Info }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.update",
            summary: "Update Design document",
            description:
              "Update a Design document; note status changes require the V1 verification rules and configured semantic review.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.design.refresh", "/api/experimental/session/:sessionID/design/:designID/refresh", {
        params: { sessionID: Session.ID, designID: Design.ID },
        success: Schema.Struct({ data: Design.Info }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.refresh",
            summary: "Refresh Design system",
            description: "Rediscover the application's design system and refresh its generated manifest.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.design.approve", "/api/experimental/session/:sessionID/design/:designID/approve", {
        params: { sessionID: Session.ID, designID: Design.ID },
        payload: Design.Approve,
        success: Schema.Struct({
          data: Schema.Struct({
            plan: Schema.String,
            revision: Schema.String,
            agent: Schema.Literals(["design", "plan"]),
            resume: Schema.Boolean,
          }),
        }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.approve",
            summary: "Approve Design revision",
            description:
              "Freeze an explicitly approved Design revision and continue its Session in Plan unless its goal stops after Design.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.design.reopen", "/api/experimental/session/:sessionID/design/:designID/reopen", {
        params: { sessionID: Session.ID, designID: Design.ID },
        success: Schema.Struct({ data: Design.Info }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.reopen",
            summary: "Reopen Design review",
            description: "Reopen a review after an explicit user request while retaining its approved revision.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get(
        "session.design.revisions",
        "/api/experimental/session/:sessionID/design/:designID/revisions",
        {
          params: { sessionID: Session.ID, designID: Design.ID },
          success: Schema.Struct({ data: Schema.Array(Design.Revision) }),
          error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
        },
      )
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.revisions",
            summary: "List Design revisions",
            description: "Read immutable Design revisions imported from Redcode V1.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.design.feedback", "/api/experimental/session/:sessionID/design/:designID/feedback", {
        params: { sessionID: Session.ID, designID: Design.ID },
        success: Schema.Struct({ data: Schema.Array(Design.Feedback) }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.feedback",
            summary: "List Design feedback",
            description: "Read admitted browser feedback retained with a Design document.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.design.assets", "/api/experimental/session/:sessionID/design/:designID/assets", {
        params: { sessionID: Session.ID, designID: Design.ID },
        success: Schema.Struct({ data: Schema.Array(Design.Asset) }),
        error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.assets",
            summary: "List Design assets",
            description: "Read the versioned asset metadata retained with a Design document.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.delete("session.remove", "/api/session/:sessionID", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.remove",
          summary: "Delete session",
          description: "Delete a session and its child sessions.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get(
        "session.design.revision",
        "/api/experimental/session/:sessionID/design/:designID/revisions/:revisionID",
        {
          params: { sessionID: Session.ID, designID: Design.ID, revisionID: Schema.String },
          success: Schema.Struct({ data: Design.Revision }),
          error: [SessionNotFoundError, DesignNotFoundError, InvalidRequestError],
        },
      )
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.design.revision",
            summary: "Get Design revision",
            description: "Read one immutable Design revision and its file manifest.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.fork", "/api/session/:sessionID/fork", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ before: SessionMessage.ID.pipe(Schema.optional) }),
        success: Schema.Struct({ data: PublicSessionInfo }),
        error: [SessionNotFoundError, MessageNotFoundError, InvalidRequestError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.fork",
            summary: "Fork session",
            description:
              "Create a child session by copying projected history before a message. Omit before to copy the full history.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.switchAgent", "/api/session/:sessionID/agent", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ agent: Agent.ID }),
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.switchAgent",
            summary: "Switch session agent",
            description: "Switch the agent used by subsequent provider turns.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.switchModel", "/api/session/:sessionID/model", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ model: Model.Ref }),
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.switchModel",
            summary: "Switch session model",
            description: "Switch the model used by subsequent provider turns.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.patch("session.update", "/api/session/:sessionID", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          title: Schema.String.pipe(Schema.optional),
          metadata: Session.Metadata.pipe(Schema.optional),
          permissions: Permission.Ruleset.pipe(Schema.optional),
        }),
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.update",
            summary: "Update session",
            description: "Update mutable session properties.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.move", "/api/session/:sessionID/move", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ ...Location.PublicRef.fields, delivery: SessionInbox.Delivery.pipe(Schema.optional) }),
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, InvalidRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.move",
          summary: "Move session",
          description: "Move a session to another project directory at the requested delivery boundary.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.prompt", "/api/session/:sessionID/prompt", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: SessionMessage.ID.pipe(Schema.optional),
          ...PromptInput.Prompt.fields,
          metadata: SessionInbox.UserPayload.fields.metadata,
          delivery: SessionInbox.Delivery.pipe(Schema.optional),
          resume: Schema.Boolean.pipe(Schema.optional),
        }),
        success: Schema.Struct({ data: SessionInbox.User }),
        error: [ConflictError, InvalidRequestError, SessionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt",
            summary: "Send message",
            description: "Durably admit one session input and schedule agent-loop execution unless resume is false.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.command", "/api/session/:sessionID/command", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          name: Schema.String,
          ...PromptInput.Prompt.fields,
          metadata: SessionInbox.UserPayload.fields.metadata,
          delivery: SessionInbox.Delivery.pipe(Schema.optional),
        }),
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, CommandNotFoundError, CommandExecutionError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.command",
            summary: "Run command",
            description: "Execute a slash command callback immediately.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.skill", "/api/experimental/session/:sessionID/skill", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: Skill.ID,
          resume: Schema.Boolean.pipe(Schema.optional),
        }),
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, SkillNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.skill",
            summary: "Activate skill",
            description: "Activate a skill for a session by appending a skill message and resuming execution.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.synthetic", "/api/session/:sessionID/synthetic", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: SessionMessage.ID.pipe(Schema.optional),
          text: Schema.String,
          description: Schema.String.pipe(Schema.optional),
          metadata: SessionMessage.Synthetic.fields.metadata,
          delivery: SessionInbox.Delivery.pipe(Schema.optional),
          resume: Schema.Boolean.pipe(Schema.optional),
        }),
        success: Schema.Struct({ data: SessionInbox.Synthetic }),
        error: [ConflictError, SessionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.synthetic",
            summary: "Add synthetic message",
            description: "Durably admit synthetic session input and schedule execution unless resume is false.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.shell", "/api/session/:sessionID/shell", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: SessionMessage.ID.pipe(Schema.optional),
          command: Schema.String,
        }),
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.shell",
            summary: "Run shell command",
            description:
              "Execute one shell command in the session's working directory. Emits a shell.started event before execution and a shell.ended event with the merged output after.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.compact", "/api/session/:sessionID/compact", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: SessionMessage.ID.pipe(Schema.optional),
          delivery: SessionInbox.Delivery.pipe(Schema.optional),
          focus: Schema.String.pipe(Schema.optional).annotate({
            description: "What the summary should cover in the most detail. Ignored when a pending compaction absorbs this request.",
          }),
        }),
        success: Schema.Struct({ data: SessionInbox.Compaction }),
        error: [ConflictError, SessionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.compact",
            summary: "Compact session",
            description:
              "Durably admit a session compaction request. Steers by default: it runs at the next step boundary instead of waiting behind queued prompts.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.wait", "/api/experimental/session/:sessionID/wait", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, ServiceUnavailableError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.wait",
            summary: "Wait for session",
            description: "Wait for a session agent loop to become idle.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.revert.stage", "/api/session/:sessionID/revert/stage", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ messageID: SessionMessage.ID, files: Schema.Boolean.pipe(Schema.optional) }),
        success: Schema.Struct({ data: Session.Revert }),
        error: [MessageNotFoundError, SessionNotFoundError, SessionBusyError, UnknownError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.revert.stage",
            summary: "Stage session revert",
            description: "Stage or move a reversible session boundary and optionally apply its file changes.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.delete("session.revert.clear", "/api/session/:sessionID/revert", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, SessionBusyError, UnknownError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "session.revert.clear", summary: "Clear staged revert" })),
    )
    .add(
      HttpApiEndpoint.post("session.revert.commit", "/api/session/:sessionID/revert/commit", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, SessionBusyError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "session.revert.commit", summary: "Commit staged revert" })),
    )
    .add(
      HttpApiEndpoint.get("session.context", "/api/session/:sessionID/context", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(PublicSessionMessage) }),
        error: [SessionNotFoundError, UnknownError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.context",
          summary: "Get session context",
          description: "Retrieve the active context messages for a session (all messages after the last compaction).",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.diff", "/api/session/:sessionID/diff", {
        params: { sessionID: Session.ID },
        query: Schema.Struct({
          scope: Schema.optional(Schema.Literal("session")).annotate({
            description:
              "Compare the whole session from its first user message through its latest. Cannot be combined with from or to.",
          }),
          from: Schema.optional(SessionMessage.ID).annotate({
            description: "User message whose turn to diff. Defaults to the turn of the newest user message.",
          }),
          to: Schema.optional(SessionMessage.ID).annotate({
            description: "Later user message whose turn ends the range. Defaults to the turn of `from` alone.",
          }),
          context: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional).annotate({
            description: "Unchanged lines around each hunk. Omit for full-file patches.",
          }),
        }),
        success: Schema.Struct({ data: Schema.Array(FileDiff.Info) }),
        error: [InvalidRequestError, MessageNotFoundError, SessionNotFoundError, UnknownError, LocationNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.diff",
          summary: "Diff session turns",
          description:
            "Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker, so prompts steered in while it was busy belong to the same turn; `to` extends the range through a later turn. Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy. Ranges that span a location change are rejected. In sessions without any idle marker, a prompt's turn spans until the next user message.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.inbox.list", "/api/session/:sessionID/inbox", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(PublicInboxInfo) }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.inbox.list",
          summary: "List session inbox",
          description:
            "List durable enqueued session work not yet delivered, ordered by enqueue sequence. Includes user, synthetic, compaction, and move items.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.delete("session.inbox.cancel", "/api/session/:sessionID/inbox/:inboxID", {
        params: { sessionID: Session.ID, inboxID: SessionMessage.ID },
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.inbox.cancel",
          summary: "Cancel inbox input",
          description: "Cancel an inbox item that has not yet been delivered. Unavailable items are a no-op.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.patch("session.inbox.update", "/api/session/:sessionID/inbox/:inboxID", {
        params: { sessionID: Session.ID, inboxID: SessionMessage.ID },
        payload: Schema.Struct({ delivery: SessionInbox.Delivery }),
        success: HttpApiSchema.NoContent,
        error: [ConflictError, SessionNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.inbox.update",
          summary: "Update inbox item",
          description: "Change a pending inbox item's delivery mode. Steering wakes session execution.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get(
        "session.instructions.entry.list",
        "/api/experimental/session/:sessionID/instructions/entries",
        {
          params: { sessionID: Session.ID },
          success: Schema.Struct({ data: Schema.Array(InstructionEntry.Info) }),
          error: SessionNotFoundError,
        },
      )
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.instructions.entry.list",
            summary: "List instruction entries",
            description: "List API-managed instruction entries attached to the session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.put(
        "session.instructions.entry.put",
        "/api/experimental/session/:sessionID/instructions/entries/:key",
        {
          params: { sessionID: Session.ID, key: InstructionEntry.Key },
          payload: Schema.Struct({ value: Schema.Json }),
          success: HttpApiSchema.NoContent,
          error: [SessionNotFoundError, InstructionEntry.ValueTooLargeError],
        },
      )
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.instructions.entry.put",
            summary: "Put instruction entry",
            description:
              "Attach or replace one durable instruction entry. Changes announce as updates at the next step boundary.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.delete(
        "session.instructions.entry.remove",
        "/api/experimental/session/:sessionID/instructions/entries/:key",
        {
          params: { sessionID: Session.ID, key: InstructionEntry.Key },
          success: HttpApiSchema.NoContent,
          error: SessionNotFoundError,
        },
      )
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.instructions.entry.remove",
            summary: "Remove instruction entry",
            description:
              "Remove one instruction entry; the removal is announced to the model at the next step boundary.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.generate", "/api/session/:sessionID/generate", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ prompt: Schema.String }),
        success: Schema.Struct({
          data: Schema.Struct({ text: Schema.String }),
        }).annotate({ identifier: "SessionGenerateResponse" }),
        error: [SessionNotFoundError, ServiceUnavailableError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.generate",
            summary: "Generate text from session context",
            description: "Generate transient text from the current session context without mutating session history.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.log", "/api/experimental/session/:sessionID/log", {
        params: { sessionID: Session.ID },
        query: {
          after: Schema.NumberFromString.pipe(Schema.decodeTo(Event.Seq), Schema.optional),
          follow: BooleanFromString.pipe(Schema.optional),
        },
        success: HttpApiSchema.StreamSse({
          data: Schema.Union([SessionEvent.Durable, EventLog.Synced]).annotate({ identifier: "SessionLogItem" }),
        }),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.log",
          summary: "Read the session log",
          description:
            "Experimental durable session event log. Reads events after an exclusive aggregate sequence and continues with live events when follow=true.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.interrupt", "/api/session/:sessionID/interrupt", {
        params: { sessionID: Session.ID },
        query: { resume: BooleanFromString.pipe(Schema.optional) },
        success: Schema.Struct({
          interrupted: Schema.Boolean.annotate({
            description: "Whether an active execution owned by this OpenCode process was interrupted.",
          }),
        }).annotate({ identifier: "SessionInterruptResponse" }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.interrupt",
            summary: "Interrupt session execution",
            description:
              "Interrupt active execution owned by this OpenCode process. Returns interrupted=true when an active execution was interrupted and false for the idle no-op. When resume=true, execution resumes pending steering input and next-in-line control items (manual compaction, moves) while queued prompts remain parked.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.background", "/api/session/:sessionID/background", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.background",
            summary: "Background blocking session tools",
            description:
              "Move active foreground backgroundable tools for this session into background observation. Idle requests are a no-op.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.message", "/api/session/:sessionID/message/:messageID", {
        params: { sessionID: Session.ID, messageID: SessionMessage.ID },
        success: Schema.Struct({ data: PublicSessionMessage }),
        error: [SessionNotFoundError, MessageNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.message.get",
          summary: "Get session message",
          description: "Retrieve one projected message owned by the Session.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.form.list", "/api/session/:sessionID/form", {
        params: { sessionID: Schema.String },
        success: Schema.Struct({ data: Schema.Array(Form.Info) }),
        error: SessionNotFoundError,
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.form.list",
            summary: "List session forms",
            description: "Retrieve pending forms for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.form.create", "/api/session/:sessionID/form", {
        params: { sessionID: Schema.String },
        payload: FormCreatePayload,
        success: Schema.Struct({ data: Form.Info }),
        error: [SessionNotFoundError, ConflictError, InvalidRequestError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.form.create",
            summary: "Create session form",
            description: "Create a form for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.form.get", "/api/session/:sessionID/form/:formID", {
        params: { sessionID: Schema.String, formID: Form.ID },
        success: Schema.Struct({ data: Form.Detail }),
        error: [SessionNotFoundError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.form.get",
            summary: "Get session form",
            description: "Retrieve a form and its current state for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.form.reply", "/api/session/:sessionID/form/:formID/reply", {
        params: { sessionID: Schema.String, formID: Form.ID },
        payload: Form.Reply,
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, FormAlreadySettledError, FormInvalidAnswerError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.form.reply",
            summary: "Reply to form",
            description: "Submit an answer to a pending form.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.delete("session.form.cancel", "/api/session/:sessionID/form/:formID", {
        params: { sessionID: Schema.String, formID: Form.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, FormAlreadySettledError, FormNotFoundError],
      })
        .middleware(formLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "session.form.cancel",
            summary: "Cancel form",
            description: "Cancel a pending form.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.put("session.environment", "/api/session/:sessionID/environment", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ variables: Schema.Record(Schema.String, Schema.String) }),
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.environment",
          summary: "Set session environment",
          description: "Replace the process environment used by local shell commands for this session.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.view", "/api/session/:sessionID/view", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ idle: DateTimeUtcFromMillis }),
        success: HttpApiSchema.NoContent,
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.view",
          summary: "View session",
          description: "Mark the idle transition observed by the viewer as viewed.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "session",
        description: "Experimental session routes.",
      }),
    )

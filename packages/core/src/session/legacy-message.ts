export * as SessionLegacyMessage from "./legacy-message"

import { DateTime } from "effect"
import { ToolContent } from "@reddb-io/redcode-schema/llm"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { SessionV1 } from "../v1/session"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

/**
 * The V2 → V1 message mirror. The V1 runtime publishes `SessionV1.Event.*` wire events that the
 * projector writes into `MessageTable`/`PartTable`, and every current client reads those tables and
 * listens to those events. While the V2 runner drives sessions, this conversion lets the same read
 * path keep working: each projected V2 message becomes the V1 info plus parts the clients already
 * render. It is removed together with the V1 read path at the end of the V2 cutover.
 */

export interface Context {
  readonly sessionID: SessionSchema.ID
  /** The session's agent and model at the time the message was created. */
  readonly agent: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly path: { readonly cwd: string; readonly root: string }
}

export interface LegacyMessage {
  readonly info: SessionV1.Info
  readonly parts: SessionV1.Part[]
}

const epoch = (time: DateTime.Utc) => DateTime.toEpochMillis(time)

const partID = (id: string) => SessionV1.PartID.make(id.startsWith("prt") ? id : `prt_${id}`)

const zeroTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const safeRecord = (input: string | Record<string, unknown>): Record<string, unknown> => {
  if (typeof input !== "string") return input
  try {
    const parsed: unknown = JSON.parse(input)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const outputOf = (content: ToolContent[] | undefined) =>
  (content ?? [])
    .map((item) => (item.type === "text" ? item.text : `[file] ${item.name ?? item.uri}`))
    .join("\n")

function assistantError(error: SessionMessage.Assistant["error"]): SessionV1.Assistant["error"] {
  if (!error) return undefined
  return { name: "UnknownError" as const, data: { message: error.message } }
}

function toolState(part: SessionMessage.AssistantTool, ctx: Context, messageID: string): SessionV1.ToolState {
  const created = epoch(part.time.created)
  const ran = part.time.ran ? epoch(part.time.ran) : created
  const completed = part.time.completed ? epoch(part.time.completed) : undefined
  const session = ctx.sessionID
  switch (part.state.status) {
    case "pending":
      return {
        status: "pending",
        input: safeRecord(part.state.input),
        raw: part.state.input,
      }
    case "running":
      return {
        status: "running",
        input: safeRecord(part.state.input),
        title: part.name,
        metadata: { structured: { ...part.state.structured }, content: [...(part.state.content ?? [])] },
        time: { start: ran },
      }
    case "completed":
      return {
        status: "completed",
        input: safeRecord(part.state.input),
        output: outputOf(part.state.content),
        title: part.name,
        metadata: {
          structured: { ...part.state.structured },
          outputPaths: [...(part.state.outputPaths ?? [])],
          content: (part.state.content ?? []).map((item) => ({ ...item })),
        },
        time: { start: ran, end: completed ?? ran },
        ...(part.state.attachments
          ? {
              attachments: part.state.attachments.map((file, index) => ({
                id: partID(`${part.id}:attachment:${index}`),
                type: "file" as const,
                sessionID: session,
                messageID: SessionV1.MessageID.make(messageID),
                mime: file.mime,
                ...(file.name ? { filename: file.name } : {}),
                url: file.uri,
              })),
            }
          : {}),
      }
    case "error":
      return {
        status: "error",
        input: safeRecord(part.state.input),
        error: part.state.error.message,
        metadata: { structured: { ...part.state.structured }, content: [...(part.state.content ?? [])] },
        time: { start: created, end: completed ?? created },
      }
  }
}

function assistantMessage(message: SessionMessage.Assistant, ctx: Context, parentID?: string): LegacyMessage {
  const created = epoch(message.time.created)
  const session = ctx.sessionID
  const messageID = message.id
  const parts: SessionV1.Part[] = [
    {
      id: partID(`${messageID}:step-start`),
      type: "step-start",
      sessionID: session,
      messageID: SessionV1.MessageID.make(messageID),
      ...(message.snapshot?.end ? { snapshot: message.snapshot.end } : {}),
    },
  ]
  for (const item of message.content) {
    if (item.type === "text")
      parts.push({
        id: partID(item.id),
        type: "text",
        sessionID: session,
        messageID: SessionV1.MessageID.make(messageID),
        text: item.text,
        time: { start: created },
      })
    if (item.type === "reasoning")
      parts.push({
        id: partID(item.id),
        type: "reasoning",
        sessionID: session,
        messageID: SessionV1.MessageID.make(messageID),
        text: item.text,
        time: { start: created, ...(item.time?.completed ? { end: epoch(item.time.completed) } : {}) },
      })
    if (item.type === "tool")
      parts.push({
        id: partID(item.id),
        type: "tool",
        sessionID: session,
        messageID: SessionV1.MessageID.make(messageID),
        callID: item.id,
        tool: item.name,
        state: toolState(item, ctx, messageID),
      })
  }
  if (message.snapshot?.end)
    parts.push({
      id: partID(`${messageID}:snapshot`),
      type: "snapshot",
      sessionID: session,
      messageID: SessionV1.MessageID.make(messageID),
      snapshot: message.snapshot.end,
    })
  const tokens = message.tokens
    ? { ...message.tokens, total: message.tokens.input + message.tokens.output + message.tokens.reasoning }
    : zeroTokens
  return {
    info: {
      id: SessionV1.MessageID.make(messageID),
      sessionID: session,
      role: "assistant",
      time: {
        created,
        ...(message.time.completed ? { completed: epoch(message.time.completed) } : {}),
      },
      parentID: SessionV1.MessageID.make(parentID ?? messageID),
      modelID: Model.ID.make(message.model.id),
      providerID: Provider.ID.make(message.model.providerID),
      mode: message.agent,
      agent: message.agent,
      path: ctx.path,
      cost: message.cost ?? 0,
      tokens,
      ...(message.finish ? { finish: message.finish } : {}),
      ...(message.error ? { error: assistantError(message.error) } : {}),
    },
    parts: [
      ...parts,
      {
        id: partID(`${messageID}:step-finish`),
        type: "step-finish",
        sessionID: session,
        messageID: SessionV1.MessageID.make(messageID),
        reason: message.finish ?? "stop",
        cost: message.cost ?? 0,
        tokens,
      },
    ],
  }
}

function userInfo(message: SessionMessage.User | SessionMessage.Synthetic | SessionMessage.Compaction, ctx: Context) {
  return {
    id: SessionV1.MessageID.make(message.id),
    sessionID: ctx.sessionID,
    role: "user" as const,
    time: { created: epoch(message.time.created) },
    agent: ctx.agent,
    model: { providerID: Provider.ID.make(ctx.model.providerID), modelID: Model.ID.make(ctx.model.modelID) },
  }
}

function userMessage(message: SessionMessage.User, ctx: Context): LegacyMessage {
  const created = epoch(message.time.created)
  const parts: SessionV1.Part[] = [
    {
      id: partID(`${message.id}:text`),
      type: "text",
      sessionID: ctx.sessionID,
      messageID: SessionV1.MessageID.make(message.id),
      text: message.text,
      time: { start: created },
    },
  ]
  ;(message.files ?? []).forEach((file, index) =>
    parts.push({
      id: partID(`${message.id}:file:${index}`),
      type: "file",
      sessionID: ctx.sessionID,
      messageID: SessionV1.MessageID.make(message.id),
      mime: file.mime,
      ...(file.name ? { filename: file.name } : {}),
      url: file.uri,
    }),
  )
  return { info: userInfo(message, ctx), parts }
}

function syntheticMessage(message: SessionMessage.Synthetic, ctx: Context): LegacyMessage {
  return {
    info: userInfo(message, ctx),
    parts: [
      {
        id: partID(`${message.id}:text`),
        type: "text",
        sessionID: ctx.sessionID,
        messageID: SessionV1.MessageID.make(message.id),
        text: message.text,
        synthetic: true,
        time: { start: epoch(message.time.created) },
      },
    ],
  }
}

function compactionMessage(message: SessionMessage.Compaction, ctx: Context): LegacyMessage {
  return {
    info: userInfo(message, ctx),
    parts: [
      {
        id: partID(`${message.id}:compaction`),
        type: "compaction",
        sessionID: ctx.sessionID,
        messageID: SessionV1.MessageID.make(message.id),
        auto: message.reason === "auto",
        ...(message.tools ? { tools: { loaded: message.tools.loaded, mcpDeferred: message.tools.mcpDeferred } } : {}),
      },
      {
        id: partID(`${message.id}:summary`),
        type: "text",
        sessionID: ctx.sessionID,
        messageID: SessionV1.MessageID.make(message.id),
        text: message.summary,
        time: { start: epoch(message.time.created) },
      },
    ],
  }
}

/** The V1 mirror of a V2 message, or `undefined` for messages the V1 wire has no shape for. */
export function toLegacy(
  message: SessionMessage.Message,
  ctx: Context,
  options?: { readonly parentID?: string },
): LegacyMessage | undefined {
  switch (message.type) {
    case "user":
      return userMessage(message, ctx)
    case "synthetic":
      return syntheticMessage(message, ctx)
    case "assistant":
      return assistantMessage(message, ctx, options?.parentID)
    case "compaction":
      return compactionMessage(message, ctx)
    // System, shell, agent-switched and model-switched have no V1 wire shape: the V1 clients never
    // rendered them and the V2 timeline reads them from the durable log.
    default:
      return undefined
  }
}

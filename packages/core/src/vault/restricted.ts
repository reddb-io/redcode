export * as VaultRestricted from "./restricted.js"

import { Message } from "@opencode/ai"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { Restricted, WITHHELD } from "@opencode/schema/vault"
import { Option, Schema } from "effect"
import type { SessionMessage } from "../session/message.js"

/**
 * User messages marked as restricted in a Session's `metadata.restricted`. A sensitive message stays in the
 * conversation but is kept out of derived text: summaries, their anchors and recent context, and titles. A withheld
 * message is also replaced by {@link WITHHELD} in every later provider request. Stored events and the local history
 * keep the original; only what is assembled from them changes.
 */

export { WITHHELD }

const decode = Schema.decodeUnknownOption(Restricted)

/** The Session's restricted messages; a missing or unreadable marker reads as none. */
export const read = (metadata: SessionMetadata | undefined): Restricted =>
  Option.getOrElse(decode(metadata?.restricted), () => ({}))

/** The Session metadata with `messageID` marked, or undefined when the marker already says as much. */
export function mark(
  metadata: SessionMetadata | undefined,
  messageID: string,
  state: "sensitive" | "withheld",
): SessionMetadata | undefined {
  const current = read(metadata)
  if (current[messageID] === state || current[messageID] === "withheld") return undefined
  return { ...metadata, restricted: { ...current, [messageID]: state } }
}

/** The messages every provider request replaces. */
export const withheld = (metadata: SessionMetadata | undefined) =>
  new Set(Object.entries(read(metadata)).flatMap(([id, state]) => (state === "withheld" ? [id] : [])))

/** The messages derived text leaves out: every marked one. */
export const excluded = (metadata: SessionMetadata | undefined) => new Set(Object.keys(read(metadata)))

/** Session messages with each excluded user message's text and attachments replaced by the placeholder. */
export const withholdMessages = (messages: ReadonlyArray<SessionMessage.Info>, ids: ReadonlySet<string>) =>
  ids.size === 0
    ? messages
    : messages.map(
        (message): SessionMessage.Info =>
          message.type === "user" && ids.has(message.id)
            ? { ...message, text: WITHHELD, files: undefined, agents: undefined, skills: undefined }
            : message,
      )

/** Provider messages with each excluded user message's content replaced by the placeholder, matched by message ID. */
export const withholdRequest = (messages: ReadonlyArray<Message>, ids: ReadonlySet<string>) =>
  ids.size === 0
    ? [...messages]
    : messages.map((message) =>
        message.role === "user" && message.id !== undefined && ids.has(message.id)
          ? Message.make({ ...message, content: [Message.text(WITHHELD)] })
          : message,
      )

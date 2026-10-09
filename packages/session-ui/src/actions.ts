import type { PromptFileAttachment } from "@opencode/client/promise"

export type SessionUserComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

/** An attachment delivered to the model as a path on the server instead of inline bytes. */
export type SessionUserAttachmentReference = {
  name: string
  mime: string
  path: string
}

export type SessionUserActions = {
  openAttachment?: (file: PromptFileAttachment) => void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /** Starts a new session from the history before this prompt, with the prompt back in the composer. */
  fork?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /** Opens the changes a turn made, given the paths its edited-files card lists. */
  viewChanges?: (input: { sessionID: string; messageID: string; files: string[] }) => void
}

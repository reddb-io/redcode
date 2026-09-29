export * as DesignNotice from "./design-notice.js"

import { Schema } from "effect"
import { Design } from "./design.js"
import { SessionMessage } from "./session-message.js"

/**
 * Transcript cards for Design facts the Session already records: admitted browser feedback is a user
 * message whose text is the rendered `<design-review>` envelope, and an approval is the synthetic
 * handoff message. Clients rebuild the compact cards from those messages instead of reading a
 * separate event, so the envelope's column-0 structure is the contract these parsers follow.
 */

const HEAD =
  /^<design-review id="([^"]+)" revision="([^"]*)" feedback="([^"]+)"(?: variant="([^"]*)")? ended="(true|false)">/
const APPROVED = ", approved. Continue in Plan."

/** The compact summary of a rendered review message; undefined for any other text. */
export function feedback(text: string): Design.FeedbackNotice | undefined {
  const head = HEAD.exec(text)
  if (!head || !Schema.is(Design.ID)(head[1]) || !Schema.is(SessionMessage.ID)(head[3])) return undefined
  // Only column-0 lines are structure; user content was indented when rendered.
  const dedent = (value: string) => value.replace(/\n {4}/g, "\n")
  const section = (name: string) =>
    new RegExp(`\\n## ${name}\\n([\\s\\S]*?)(?=\\n\\n## |\\n</design-review>|$)`).exec(text)?.[1] ?? ""
  const operation = /^Operation: (.+)$/m.exec(section("Variant operation"))?.[1]
  return {
    ...(operation ? { operation } : {}),
    id: head[1],
    feedback: head[3],
    revision: head[2],
    variant: head[4] ?? null,
    ended: head[5] === "true",
    text: dedent(section("Message")),
    notes: [...section("Notes \\(\\d+\\)").matchAll(/^### \d+\. (.*(?:\n {4}.*)*)\nNote: (.*(?:\n {4}.*)*)/gm)].map(
      (match) => ({ label: dedent(match[1]), text: dedent(match[2]) }),
    ),
    attachments: [...section("Attachments").matchAll(/^- image \d+: (.*) \(attached as a file\)$/gm)].map(
      (match) => match[1],
    ),
    snapshot: text.includes('"section":"snapshot"'),
  }
}

/**
 * The approval card of a Design handoff message: its metadata names the design and revision, and its
 * first line the design's name and the approved variant. Undefined for any other message.
 */
export function approval(message: {
  readonly text: string
  readonly metadata?: Readonly<Record<string, unknown>>
}): Design.ApprovalNotice | undefined {
  const id = message.metadata?.designID
  const revision = message.metadata?.revision
  if (message.metadata?.source !== "design.approval" || !Schema.is(Design.ID)(id) || typeof revision !== "string")
    return undefined
  const line = message.text.split("\n", 1)[0] ?? ""
  // The revision is known from the metadata, so a comma in the design's name cannot shift the split.
  const marker = `, revision ${revision}`
  const at = line.indexOf(marker)
  if (!line.startsWith("Design ") || at < 0) return undefined
  const rest = line.slice(at + marker.length)
  const variant = /^, variant (.+) \(([a-zA-Z0-9_-]{1,64})\), approved\. Continue in Plan\.$/.exec(rest)
  if (!variant && rest !== APPROVED) return undefined
  return {
    id,
    name: line.slice("Design ".length, at),
    revision,
    variant: variant ? { id: variant[2], name: variant[1] } : null,
  }
}

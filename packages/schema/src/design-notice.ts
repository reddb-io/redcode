export * as DesignNotice from "./design-notice.js"

import { Schema } from "effect"
import { Design } from "./design.js"
import { SessionMessage } from "./session-message.js"

/**
 * Transcript cards for Design facts the Session already records: admitted browser feedback is a user
 * message whose text is the rendered `<design-review>` envelope, and an approval is the synthetic
 * handoff message. Clients rebuild the compact cards from those messages instead of reading a
 * separate event, so the envelope's column-0 structure is the contract these parsers follow.
 *
 * The pieces below are that contract: core renders the envelope and the handoff line with them and
 * the parsers read them back, so the two sides cannot drift apart.
 */

/** Closes the envelope; user text that would reproduce it is neutralised by `userText`. */
export const CLOSE = "</design-review>"
/** Column-0 section headings of a rendered review, without their `## ` prefix. */
export const SECTION = {
  operation: "Variant operation",
  message: "Message",
  notes: "Notes",
  whiteboards: "Whiteboards",
  preview: "Preview parameters",
  attachments: "Attachments",
  next: "Next step",
} as const
/** Column-0 labels inside the sections the compact card reads. */
export const LABEL = { note: "Note: ", operation: "Operation: " } as const
/** User content continues on lines indented by this, so it never starts at column 0. */
const INDENT = "    "
const ATTACHED = " (attached as a file)"
const APPROVAL_PREFIX = "Design "
const APPROVAL_SUFFIX = ", approved. Continue in Plan."
const VARIANT_ID = "[a-zA-Z0-9_-]{1,64}"

const HEAD =
  /^<design-review id="([^"]+)" revision="([^"]*)" feedback="([^"]+)"(?: variant="([^"]*)")? ended="(true|false)">/

/** The opening tag; attribute values are expected to be free of quotes and line breaks. */
export function open(input: {
  readonly id: string
  readonly revision: string
  readonly feedback: string
  readonly variant: string | null
  readonly ended: boolean
}) {
  return `<design-review id="${input.id}" revision="${input.revision}" feedback="${input.feedback}"${input.variant ? ` variant="${input.variant}"` : ""} ended="${input.ended}">`
}

/**
 * User-provided text must not close the envelope or forge a section: continuation lines are
 * indented so nothing the user wrote starts at column 0, where headings and labels live.
 */
export function userText(text: string) {
  return text.trim().replaceAll("</design-review", "[/design-review").replace(/\r?\n/g, `\n${INDENT}`)
}

export function notesHeading(count: number) {
  return `## ${SECTION.notes} (${count})`
}

export function noteHeading(position: number, label: string) {
  return `### ${position}. ${label}`
}

/** One attached image; `position` counts from 1. */
export function attachment(position: number, name: string) {
  return `- image ${position}: ${name}${ATTACHED}`
}

/** The tool call that fetches a review's page-text snapshot; its presence marks a captured snapshot. */
export function snapshotRequest(id: string, feedback: string) {
  return `design_read {"id":"${id}","section":"snapshot","feedback":"${feedback}"}`
}

/** The first line of the approval handoff message. */
export function approvalLine(input: {
  readonly name: string
  readonly revision: string
  readonly variant: Design.Variant | null
}) {
  return `${APPROVAL_PREFIX}${input.name}, revision ${input.revision}${input.variant ? `, variant ${input.variant.name} (${input.variant.id})` : ""}${APPROVAL_SUFFIX}`
}

/** The compact summary of a rendered review message; undefined for any other text. */
export function feedback(text: string): Design.FeedbackNotice | undefined {
  const head = HEAD.exec(text)
  if (!head || !Schema.is(Design.ID)(head[1]) || !Schema.is(SessionMessage.ID)(head[3])) return undefined
  // Only column-0 lines are structure; user content was indented when rendered.
  const dedent = (value: string) => value.replaceAll(`\n${INDENT}`, "\n")
  const section = (name: string) =>
    new RegExp(`\\n## ${name}\\n([\\s\\S]*?)(?=\\n\\n## |\\n${escape(CLOSE)}|$)`).exec(text)?.[1] ?? ""
  // A label or note text runs on over the indented continuation lines `userText` produced.
  const continued = `.*(?:\\n${INDENT}.*)*`
  const operation = new RegExp(`^${escape(LABEL.operation)}(.+)$`, "m").exec(section(escape(SECTION.operation)))?.[1]
  return {
    ...(operation ? { operation } : {}),
    id: head[1],
    feedback: head[3],
    revision: head[2],
    variant: head[4] ?? null,
    ended: head[5] === "true",
    text: dedent(section(escape(SECTION.message))),
    notes: [
      ...section(`${escape(SECTION.notes)} \\(\\d+\\)`).matchAll(
        new RegExp(`^### \\d+\\. (${continued})\\n${escape(LABEL.note)}(${continued})`, "gm"),
      ),
    ].map((match) => ({ label: dedent(match[1]), text: dedent(match[2]) })),
    attachments: [
      ...section(escape(SECTION.attachments)).matchAll(new RegExp(`^- image \\d+: (.*)${escape(ATTACHED)}$`, "gm")),
    ].map((match) => match[1]),
    snapshot: text.includes(snapshotRequest(head[1], head[3])),
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
  if (!line.startsWith(APPROVAL_PREFIX) || at < 0) return undefined
  const rest = line.slice(at + marker.length)
  const variant = new RegExp(`^, variant (.+) \\((${VARIANT_ID})\\)${escape(APPROVAL_SUFFIX)}$`).exec(rest)
  if (!variant && rest !== APPROVAL_SUFFIX) return undefined
  return {
    id,
    name: line.slice(APPROVAL_PREFIX.length, at),
    revision,
    variant: variant ? { id: variant[2], name: variant[1] } : null,
  }
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

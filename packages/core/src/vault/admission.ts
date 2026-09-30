export * as VaultAdmission from "./admission.js"

import { Base64, type PromptMention } from "@opencode/schema/prompt"
import type { Project } from "@opencode/schema/project"
import { UserPayload } from "@opencode/schema/session-inbox"
import { Effect } from "effect"
import { Vault } from "./vault.js"

type Replacement = { readonly start: number; readonly end: number; readonly name: string; readonly kind: string }

/**
 * A user prompt about to be admitted, with every high-confidence secret in its text and its text attachments moved
 * into the project vault and replaced by its reference, so the durable inbox event, the stored message and every
 * provider request carry only the reference. Low-confidence findings stay: replacing a hash the user meant would
 * break the request. Everything outside a secret stays byte-identical; a mention after a secret shifts with the
 * text and one that covers a secret is dropped. The message metadata records `vault: [{ name, kind }]`, never a
 * value, and a prompt without a secret comes back unchanged.
 */
export const protect = Effect.fn("VaultAdmission.protect")(function* (
  vault: Vault.Interface,
  projectID: Project.ID,
  payload: UserPayload,
) {
  const replaced = yield* replacements(vault, projectID, payload.text)
  const attachments = yield* Effect.forEach(payload.files ?? [], (file) =>
    Effect.gen(function* () {
      if (file.mime !== "text/plain") return { file, moved: [] }
      const content = Buffer.from(file.data, "base64").toString("utf8")
      const found = yield* replacements(vault, projectID, content)
      if (found.length === 0) return { file, moved: found }
      return {
        file: { ...file, data: Base64.make(Buffer.from(splice(content, found)).toString("base64")) },
        moved: found,
      }
    }),
  )
  const moved = [...replaced, ...attachments.flatMap((item) => item.moved)]
  if (moved.length === 0) return payload
  return UserPayload.make({
    ...payload,
    text: splice(payload.text, replaced),
    files:
      payload.files === undefined
        ? undefined
        : attachments.map((item) => ({ ...item.file, mention: shift(item.file.mention, replaced) })),
    agents: payload.agents?.map((agent) => ({ ...agent, mention: shift(agent.mention, replaced) })),
    skills: payload.skills?.map((skill) => ({ ...skill, mention: shift(skill.mention, replaced) })),
    metadata: {
      ...payload.metadata,
      vault: Array.from(new Map(moved.map((item) => [item.name, { name: item.name, kind: item.kind }])).values()),
    },
  })
})

/** `protect` for text that carries no mentions or metadata, such as a `/compact` focus. */
export const protectText = Effect.fn("VaultAdmission.protectText")(function* (
  vault: Vault.Interface,
  projectID: Project.ID,
  text: string,
) {
  return splice(text, yield* replacements(vault, projectID, text))
})

const replacements = Effect.fn("VaultAdmission.replacements")(function* (
  vault: Vault.Interface,
  projectID: Project.ID,
  text: string,
) {
  return yield* Effect.forEach(Vault.capturable(text), (item) =>
    vault
      .put({ projectID, kind: item.kind, value: item.value })
      .pipe(Effect.map((name): Replacement => ({ start: item.start, end: item.end, name, kind: item.kind }))),
  )
})

/** `text` with each replacement's span replaced by its reference; the replacements are sorted and disjoint. */
function splice(text: string, replaced: ReadonlyArray<Replacement>) {
  return (
    replaced
      .map(
        (item, index) => text.slice(index === 0 ? 0 : replaced[index - 1].end, item.start) + Vault.reference(item.name),
      )
      .join("") + text.slice(replaced.at(-1)?.end ?? 0)
  )
}

function shift(mention: PromptMention | undefined, replaced: ReadonlyArray<Replacement>) {
  if (mention === undefined || replaced.length === 0) return mention
  if (replaced.some((item) => item.start < mention.end && mention.start < item.end)) return undefined
  const delta = replaced
    .filter((item) => item.end <= mention.start)
    .reduce((sum, item) => sum + Vault.reference(item.name).length - (item.end - item.start), 0)
  return delta === 0 ? mention : { ...mention, start: mention.start + delta, end: mention.end + delta }
}

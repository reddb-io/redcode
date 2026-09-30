export * as VaultInstructions from "./instructions.js"

import type { Project } from "@opencode/schema/project"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { Vault } from "./vault.js"

/**
 * How the vault works, for an agent with a tool that resolves references: stable text, so it stays in the epoch
 * baseline and the provider cache. Bump `GUIDE_VERSION` with the text so a running Session receives the new one.
 */
export const GUIDE = [
  "Secrets: this project keeps secrets in its git-ignored .env file, and you see each one only as a reference such as {vault:github-token}, the variable GITHUB_TOKEN, never its value.",
  "A reference in a user message stands for that credential; use it and do not ask for the value again.",
  "Write references where the value belongs: in shell commands (any quoting, headers, JSON bodies, heredocs), webfetch URLs, MCP arguments, and .env files git ignores.",
  "Secrets in tool output, such as a token a login returns, come back as new references; for an opaque value no pattern recognizes, run the command with `capture`.",
  "When you need a secret the vault lacks, call vault_request with a name and a purpose instead of asking in chat.",
  "The first time a secret goes to a new host the user approves it, so name the host plainly in the command, as a literal URL rather than a variable.",
  "Never print, echo, log or commit a secret, and never paste one into code, a git remote URL or any file other than an ignored .env.",
  "An unknown reference means the vault does not hold it, for example after the service restarted: request it again.",
].join(" ")

const GUIDE_VERSION = 2

const Entry = Schema.Struct({ name: Schema.String, kind: Schema.String, hosts: Schema.Array(Schema.String) })
type Entry = typeof Entry.Type

const list = (entries: ReadonlyArray<Entry>) =>
  entries
    .map((entry) => {
      const hosts = entry.hosts.length === 0 ? "" : `; may go to ${entry.hosts.join(", ")} without asking`
      return `- ${Vault.reference(entry.name)} (${entry.kind}${hosts})`
    })
    .join("\n")

export interface Interface {
  /**
   * The guide, only when `sinks` says the agent has a tool that resolves references, and the names the project's
   * vault holds, never a value. Another project's names never appear; an empty vault adds nothing.
   */
  readonly load: (
    projectID: Project.ID,
    options: { readonly sinks: boolean; readonly directory?: string },
  ) => Instructions.List
}

export class Service extends Context.Service<Service, Interface>()("@redcode/VaultInstructions") {}

/** Tools that turn a reference into its value, or ask for one; an agent without any gets no guide. */
export const SINKS: ReadonlySet<string> = new Set(["shell", "webfetch", "vault_request", "write", "edit", "patch"])

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const vault = yield* Vault.Service
    return Service.of({
      load: (projectID, options) =>
        Instructions.combine([
          Instructions.make<typeof GUIDE_VERSION>({
            key: Instructions.Key.make("vault/guide"),
            codec: Schema.toCodecJson(Schema.Literal(GUIDE_VERSION)),
            read: Effect.succeed(options.sinks ? GUIDE_VERSION : Instructions.removed),
            render: {
              initial: () => GUIDE,
              changed: () => `The guidance on secrets changed. This supersedes it.\n\n${GUIDE}`,
              removed: () => "Vault references no longer resolve for you; do not write them.",
            },
          }),
          Instructions.make<ReadonlyArray<Entry>>({
            key: Instructions.Key.make("vault/names"),
            codec: Schema.toCodecJson(Schema.Array(Entry)),
            read: (options.directory === undefined
              ? Effect.void
              : vault.attach({ projectID, directory: options.directory })
            ).pipe(
              Effect.andThen(vault.list(projectID)),
              Effect.map((entries) =>
                entries.length === 0
                  ? Instructions.removed
                  : entries
                      .map((entry) => ({ name: entry.name, kind: entry.kind, hosts: entry.hosts ?? [] }))
                      .toSorted((left, right) => left.name.localeCompare(right.name)),
              ),
            ),
            render: {
              initial: (entries) => `Vault references in this project (values are never shown):\n${list(entries)}`,
              changed: (_previous, entries) =>
                `The project vault changed. It now holds these references:\n${list(entries)}`,
              removed: () => "The project vault is now empty; earlier references no longer resolve.",
            },
          }),
        ]),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Vault.node] })

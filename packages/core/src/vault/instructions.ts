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
  "Secrets live in the project's git-ignored .env; you see references like {vault:github-token} (GITHUB_TOKEN), never values.",
  "A reference in a user message stands for that credential; use it and do not ask for the value again.",
  "Use references in shell commands (any quoting), webfetch URLs, MCP arguments and ignored .env files.",
  "Tool-output secrets become references; use shell `capture` for unrecognized opaque values.",
  "Call vault_request with name and purpose only for a required missing credential; never ask in chat.",
  "Connected MCP servers manage authentication. Use their tools; only a real credential error justifies requesting a secret. vault_request cannot cancel, unlock execution, recover failed calls or stand in as a placeholder. After refusal, wait for new instructions; never repeat or rename the request.",
  "Sending a secret to a new host requires approval; use a literal URL.",
  "Never print, log or commit secrets, or write them outside an ignored .env.",
  "An unknown reference means the vault lacks that credential; request it only if required.",
].join(" ")

const GUIDE_VERSION = 4

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
    options: { readonly sinks: boolean; readonly directory?: string; readonly enabled?: boolean },
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
            read: Effect.succeed(options.enabled !== false && options.sinks ? GUIDE_VERSION : Instructions.removed),
            render: {
              initial: () => GUIDE,
              changed: () => `The guidance on secrets changed. This supersedes it.\n\n${GUIDE}`,
              removed: () => "Vault references no longer resolve for you; do not write them.",
            },
          }),
          Instructions.make<ReadonlyArray<Entry>>({
            key: Instructions.Key.make("vault/names"),
            codec: Schema.toCodecJson(Schema.Array(Entry)),
            read:
              options.enabled === false
                ? Effect.succeed(Instructions.removed)
                : (options.directory === undefined
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

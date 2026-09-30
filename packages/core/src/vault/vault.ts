export * as Vault from "./vault.js"

import { Clock, Context, Effect, Layer } from "effect"
import type { Project } from "@opencode/schema/project"
import { Definition, Entry, Moved, reference } from "@opencode/schema/vault"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/**
 * The project vault: secrets moved out of a conversation, which the model only ever sees as `{vault:<name>}`.
 *
 * A secret belongs to exactly one project, the Session's `Project.ID`, which every worktree of a repository shares.
 * Another project cannot list, resolve or scrub with it, and there is no global scope to fall back to. Sharing with
 * another project is a later, explicit grant that `resolve` and `list` will check; callers keep passing the project
 * that asks.
 *
 * This implementation keeps values in this process's memory, so they are lost when the service restarts and a
 * reference to one then resolves to nothing. The interface is what a persistent backend replaces without changing
 * callers: an encrypted store with a passphrase-derived key, AES-256-GCM and per-project subkeys, which the user
 * unlocks and locks. A value leaves the vault only through `resolve`, at an execution sink; nothing here logs or
 * publishes one.
 */

export { Definition, Entry, Moved, reference }

export interface Interface {
  /** The name of `value` in the project, stored under a new `<kind>-<n>` name unless it is already there. */
  readonly put: (input: {
    readonly projectID: Project.ID
    readonly kind: string
    readonly value: string
  }) => Effect.Effect<string>
  /** The value behind a name, or undefined for a name this project does not have. */
  readonly resolve: (input: {
    readonly projectID: Project.ID
    readonly name: string
  }) => Effect.Effect<string | undefined>
  readonly list: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<Entry>>
  /** Whether the name existed; its name is never given to another value. */
  readonly forget: (input: { readonly projectID: Project.ID; readonly name: string }) => Effect.Effect<boolean>
  /** `text` with every stored value of the project replaced by its reference, longest value first. */
  readonly scrub: (projectID: Project.ID, text: string) => Effect.Effect<string>
  /** `scrub` for one project as a plain function, for callers that clean many strings of one result. */
  readonly scrubber: (projectID: Project.ID) => Effect.Effect<(text: string) => string>
  readonly references: (text: string) => ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vault") {}

/**
 * The project of the Session whose tool call is running, provided around tool execution. Outside it nothing
 * resolves, so a reference reaching a sink there fails as unknown.
 */
export interface Binding {
  readonly projectID: Project.ID
  readonly resolve: (name: string) => Effect.Effect<string | undefined>
  readonly scrub: (text: string) => Effect.Effect<string>
}

export const Current = Context.Reference<Binding | undefined>("@opencode/Vault/Current", {
  defaultValue: () => undefined,
})

const PATTERN = /\{vault:([a-z0-9][a-z0-9-]{0,63})\}/g

/** The names referenced in `text`, each once, in order of appearance. */
export const references = (text: string) =>
  text.includes("{vault:") ? Array.from(new Set(Array.from(text.matchAll(PATTERN), (match) => match[1]))) : []

/** What a sink tells the model when a reference does not resolve for its project. */
export const unknownReference = (name: string) =>
  `Unknown vault reference ${reference(name)}: ask the user to add it by pasting the secret in a message in this project.`

/**
 * The values of `names` for the running tool call's project, or the first name that has none. Without a binding,
 * such as outside a Session's tool execution, no name resolves.
 */
/** Every reference resolved, or the first name that did not. */
export type Resolution = { readonly missing: string } | { readonly values: ReadonlyMap<string, string> }

export const resolveAll = Effect.fn("Vault.resolveAll")(function* (names: ReadonlyArray<string>) {
  const binding = yield* Current
  const resolved = yield* Effect.forEach(names, (name) =>
    (binding ? binding.resolve(name) : Effect.succeed(undefined)).pipe(Effect.map((value) => ({ name, value }))),
  )
  const missing = resolved.find((item) => item.value === undefined)
  // Declared, not inferred: an inferred union of two object literals gains `?: undefined` members and `in` stops narrowing.
  const result: Resolution = missing
    ? { missing: missing.name }
    : {
        values: new Map(
          resolved.flatMap((item) => (item.value === undefined ? [] : [[item.name, item.value] as const])),
        ),
      }
  return result
})

/** `text` with each resolved reference replaced by its value; an unresolved one stays as written. */
export const fill = (text: string, values: ReadonlyMap<string, string>) =>
  text.replace(PATTERN, (match, name: string) => values.get(name) ?? match)

/** `fill` over every string reached from a record's values, such as tool arguments. */
export const fillRecord = (record: Readonly<Record<string, unknown>>, values: ReadonlyMap<string, string>) =>
  scrubRecord(record, (text) => fill(text, values))

/** Every string of a JSON-like value through `clean`, such as a tool's output or metadata. */
export const scrubDeep = (value: unknown, clean: (text: string) => string) => mapStrings(value, clean, 0)

/** Every string reached from a record's values through `clean`, keeping its keys. */
export const scrubRecord = (record: Readonly<Record<string, unknown>>, clean: (text: string) => string) =>
  Object.fromEntries(Object.entries(record).map(([key, item]) => [key, mapStrings(item, clean, 0)]))

type Stored = Entry & { readonly value: string }

type Shelf = {
  readonly byName: Map<string, Stored>
  readonly byValue: Map<string, string>
  /** Only grows, so a forgotten name is never reused for another value that old references would then reach. */
  readonly counters: Map<string, number>
  /** Longest value first, so a value that contains another is replaced whole. */
  longest: ReadonlyArray<Stored>
}

export const layer = Layer.sync(Service, () => {
  const shelves = new Map<Project.ID, Shelf>()
  const shelf = (projectID: Project.ID) => {
    const existing = shelves.get(projectID)
    if (existing) return existing
    const created: Shelf = { byName: new Map(), byValue: new Map(), counters: new Map(), longest: [] }
    shelves.set(projectID, created)
    return created
  }
  const sort = (target: Shelf) => {
    target.longest = Array.from(target.byName.values()).toSorted(
      (left, right) => right.value.length - left.value.length,
    )
  }
  const clean = (projectID: Project.ID) => {
    const entries = shelves.get(projectID)?.longest ?? []
    return (text: string) =>
      entries.reduce(
        (current, entry) =>
          current.includes(entry.value) ? current.replaceAll(entry.value, reference(entry.name)) : current,
        text,
      )
  }

  return Service.of({
    put: Effect.fn("Vault.put")(function* (input) {
      const target = shelf(input.projectID)
      const existing = target.byValue.get(input.value)
      if (existing !== undefined) return existing
      const kind =
        input.kind
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || "secret"
      const name = nextName(target, kind)
      const stored = { name, kind, created: yield* Clock.currentTimeMillis, value: input.value }
      target.byName.set(name, stored)
      target.byValue.set(input.value, name)
      sort(target)
      return name
    }),
    resolve: (input) => Effect.sync(() => shelves.get(input.projectID)?.byName.get(input.name)?.value),
    list: (projectID) =>
      Effect.sync(() =>
        Array.from(shelves.get(projectID)?.byName.values() ?? [], (stored) =>
          Entry.make({ name: stored.name, kind: stored.kind, created: stored.created }),
        ),
      ),
    forget: (input) =>
      Effect.sync(() => {
        const target = shelves.get(input.projectID)
        const stored = target?.byName.get(input.name)
        if (!target || !stored) return false
        target.byName.delete(input.name)
        target.byValue.delete(stored.value)
        sort(target)
        return true
      }),
    scrub: (projectID, text) => Effect.sync(() => clean(projectID)(text)),
    scrubber: (projectID) => Effect.sync(() => clean(projectID)),
    references,
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

/** The binding a tool call for `projectID` runs under. */
export const bind = (vault: Interface, projectID: Project.ID): Binding => ({
  projectID,
  resolve: (name) => vault.resolve({ projectID, name }),
  scrub: (text) => vault.scrub(projectID, text),
})

function nextName(target: Shelf, kind: string): string {
  const count = (target.counters.get(kind) ?? 0) + 1
  target.counters.set(kind, count)
  const name = `${kind}-${count}`
  // A kind that itself ends in a number could meet another kind's name; skip past it.
  return target.byName.has(name) ? nextName(target, kind) : name
}

function mapStrings(value: unknown, map: (text: string) => string, depth: number): unknown {
  if (typeof value === "string") return map(value)
  if (depth > 32 || typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map, depth + 1))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map, depth + 1)]))
}

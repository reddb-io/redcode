export * as Vault from "./vault.js"

import { Clock, Context, Effect, Layer } from "effect"
import type { Project } from "@opencode/schema/project"
import { Definition, Entry, Moved, reference, sanitize } from "@opencode/schema/vault"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Redact } from "@opencode/util/redact"

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

export { Definition, Entry, Moved, reference, sanitize }

/**
 * Where a secret came from, which decides what a new value under a taken name does: the user's own `set` replaces
 * it, a value the model captured under a name replaces only another captured value, and a request never replaces.
 */
export type Origin = "pasted" | "user" | "requested" | "captured"

export interface Interface {
  /** The name of `value` in the project, stored under a new `<kind>-<n>` name unless it is already there. */
  readonly put: (input: {
    readonly projectID: Project.ID
    readonly kind: string
    readonly value: string
    /** Destinations the value may go back to without asking, such as the host whose response carried it. */
    readonly hosts?: ReadonlyArray<string>
  }) => Effect.Effect<string>
  /**
   * `value` under `name`, made reference-safe; the stored name, which differs from the asked one when that name
   * is held by a value `origin` may not replace. An unusable name falls back to `<kind>-<n>`.
   */
  readonly set: (input: {
    readonly projectID: Project.ID
    readonly name: string
    readonly value: string
    readonly origin: Exclude<Origin, "pasted">
    readonly kind?: string
    readonly hosts?: ReadonlyArray<string>
  }) => Effect.Effect<string>
  /** The value behind a name, or undefined for a name this project does not have. */
  readonly resolve: (input: {
    readonly projectID: Project.ID
    readonly name: string
  }) => Effect.Effect<string | undefined>
  readonly list: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<Entry>>
  /** Whether the name existed; its name is never given to another value. */
  readonly forget: (input: { readonly projectID: Project.ID; readonly name: string }) => Effect.Effect<boolean>
  /** Lets the secret go to `destination` without asking again, until it is forgotten. */
  readonly allow: (input: {
    readonly projectID: Project.ID
    readonly name: string
    readonly destination: string
  }) => Effect.Effect<void>
  /** `text` with every stored value of the project replaced by its reference, longest value first, in one pass. */
  readonly scrub: (projectID: Project.ID, text: string) => Effect.Effect<string>
  /** `scrub` for one project as a plain function, for callers that clean many strings of one result. */
  readonly scrubber: (projectID: Project.ID) => Effect.Effect<(text: string) => string>
  readonly references: (text: string) => ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vault") {}

/** What a sink's `capture` stored: a cleaner that knows the new values too, and the new names in order. */
export interface Captured {
  readonly clean: (text: string) => string
  readonly names: ReadonlyArray<string>
}

/**
 * The project of the Session whose tool call is running, provided around tool execution. Outside it nothing
 * resolves, so a reference reaching a sink there fails as unknown.
 */
export interface Binding {
  readonly projectID: Project.ID
  readonly resolve: (name: string) => Effect.Effect<string | undefined>
  readonly scrub: (text: string) => Effect.Effect<string>
  /** `scrub` as a plain function over the vault as it is now. */
  readonly scrubber: Effect.Effect<(text: string) => string>
  /**
   * Stores every high-confidence secret in `texts` that the vault does not hold yet, bound to `hosts`, the
   * destinations the output came from, and returns a cleaner that replaces every stored value by its reference.
   */
  readonly capture: (texts: ReadonlyArray<string>, hosts?: ReadonlyArray<string>) => Effect.Effect<Captured>
  /** `Interface.set` for this project; an empty name stores under a new `<kind>-<n>` name. */
  readonly set: (input: {
    readonly name: string
    readonly value: string
    readonly origin: "requested" | "captured"
    readonly kind?: string
    readonly hosts?: ReadonlyArray<string>
  }) => Effect.Effect<string>
  /** The destinations each name may be sent to without asking; a name the project lacks has none. */
  readonly hosts: (names: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<string>>>
  readonly allow: (name: string, destination: string) => Effect.Effect<void>
}

export const Current = Context.Reference<Binding | undefined>("@opencode/Vault/Current", {
  defaultValue: () => undefined,
})

const PATTERN = /\{vault:([a-z0-9][a-z0-9-]{0,63})\}/g

/**
 * A value shorter than this is not moved out of text on its own, such as `"password": "test"`: every later tool
 * result is scrubbed of a stored value, and scrubbing a common short word would corrupt them.
 */
const MIN_LENGTH = 8

/** The names referenced in `text`, each once, in order of appearance. */
export const references = (text: string) =>
  text.includes("{vault:") ? Array.from(new Set(Array.from(text.matchAll(PATTERN), (match) => match[1]))) : []

/**
 * The high-confidence secrets in `text` that are worth moving into the vault. Low-confidence findings stay, since
 * replacing a hash someone meant would break their request, and a reference is never a secret itself.
 */
export const capturable = (text: string) =>
  Redact.findSecrets(text).filter(
    (item) => item.confidence === "high" && item.value.length >= MIN_LENGTH && references(item.value).length === 0,
  )

/** What a sink tells the model when a reference does not resolve for its project. */
export const unknownReference = (name: string) =>
  `Unknown vault reference ${reference(name)}: call vault_request to ask the user for it, or ask them to add it with /vault add ${name}.`

/** The line a result ends with after `capture` stored secrets from it, naming only references. */
export const captureNote = (names: ReadonlyArray<string>) => {
  if (names.length === 0) return ""
  const listed = names.map(reference).join(", ")
  return names.length === 1
    ? `Stored 1 secret from the output as ${listed}; use that reference in later commands.`
    : `Stored ${names.length} secrets from the output as ${listed}; use those references in later commands.`
}

/** Every reference resolved, or the first name that did not. */
export type Resolution = { readonly missing: string } | { readonly values: ReadonlyMap<string, string> }

/**
 * The values of `names` for the running tool call's project, or the first name that has none. Without a binding,
 * such as outside a Session's tool execution, no name resolves.
 */
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

/** Every string of a JSON-like value, such as a tool's structured output, for `capture`. */
export const strings = (value: unknown) => {
  const found: string[] = []
  mapStrings(
    value,
    (text) => {
      found.push(text)
      return text
    },
    0,
  )
  return found
}

type Stored = Entry & { readonly value: string; readonly origin: Origin; readonly allowed: Set<string> }

type Shelf = {
  readonly byName: Map<string, Stored>
  readonly byValue: Map<string, string>
  /** Only grows, so a forgotten name is never reused for another value that old references would then reach. */
  readonly counters: Map<string, number>
  /** Every value, longest first, so a value that contains another is replaced whole; undefined for an empty shelf. */
  pattern: RegExp | undefined
}

/** A process-memory vault; `layer` provides one, and tests build their own. */
export const make = (): Interface => {
  const shelves = new Map<Project.ID, Shelf>()
  const shelf = (projectID: Project.ID) => {
    const existing = shelves.get(projectID)
    if (existing) return existing
    const created: Shelf = { byName: new Map(), byValue: new Map(), counters: new Map(), pattern: undefined }
    shelves.set(projectID, created)
    return created
  }
  // Rebuilt on every change: a value two names hold is scrubbed to the older one, whichever of them changes.
  const index = (target: Shelf) => {
    target.byValue.clear()
    target.byName.forEach((stored) => {
      if (!target.byValue.has(stored.value)) target.byValue.set(stored.value, stored.name)
    })
    const values = Array.from(target.byValue.keys()).toSorted((left, right) => right.length - left.length)
    target.pattern =
      values.length === 0 ? undefined : new RegExp(values.map((value) => value.replace(ESCAPE, "\\$&")).join("|"), "g")
  }
  // One pass over the text, so a replacement is never matched again by a shorter value inside its reference.
  const clean = (projectID: Project.ID) => {
    const target = shelves.get(projectID)
    const pattern = target?.pattern
    if (!target || !pattern) return (text: string) => text
    return (text: string) =>
      text.replace(pattern, (value) => {
        const name = target.byValue.get(value)
        return name === undefined ? value : reference(name)
      })
  }
  const store = Effect.fn("Vault.store")(function* (
    target: Shelf,
    input: { name: string; kind: string; value: string; origin: Origin; hosts?: ReadonlyArray<string> },
  ) {
    const previous = target.byName.get(input.name)
    target.byName.set(input.name, {
      name: input.name,
      kind: input.kind,
      created: yield* Clock.currentTimeMillis,
      value: input.value,
      origin: input.origin,
      // A new value under a known name keeps where the name may go: the user or the login flow replaced it.
      allowed: new Set([...(previous?.allowed ?? []), ...(input.hosts ?? [])]),
    })
    index(target)
    return input.name
  })

  return Service.of({
    put: Effect.fn("Vault.put")(function* (input) {
      const target = shelf(input.projectID)
      const existing = target.byValue.get(input.value)
      if (existing !== undefined) {
        input.hosts?.forEach((host) => target.byName.get(existing)?.allowed.add(host))
        return existing
      }
      const kind = sanitize(input.kind).slice(0, 48).replace(/-$/, "") || "secret"
      return yield* store(target, {
        name: nextName(target, kind),
        kind,
        value: input.value,
        origin: "pasted",
        hosts: input.hosts,
      })
    }),
    set: Effect.fn("Vault.set")(function* (input) {
      const target = shelf(input.projectID)
      const kind = sanitize(input.kind ?? input.name).slice(0, 48).replace(/-$/, "") || "secret"
      const asked = sanitize(input.name)
      const held = asked ? target.byName.get(asked) : undefined
      if (held?.value === input.value) {
        input.hosts?.forEach((host) => held.allowed.add(host))
        return held.name
      }
      const replaces =
        held === undefined || input.origin === "user" || (input.origin === "captured" && held.origin === "captured")
      const name = asked === "" ? nextName(target, kind) : replaces ? asked : nextName(target, asked)
      return yield* store(target, { name, kind, value: input.value, origin: input.origin, hosts: input.hosts })
    }),
    resolve: (input) => Effect.sync(() => shelves.get(input.projectID)?.byName.get(input.name)?.value),
    list: (projectID) =>
      Effect.sync(() =>
        Array.from(shelves.get(projectID)?.byName.values() ?? [], (stored) =>
          Entry.make({
            name: stored.name,
            kind: stored.kind,
            created: stored.created,
            ...(stored.allowed.size === 0 ? {} : { hosts: Array.from(stored.allowed).toSorted() }),
          }),
        ),
      ),
    forget: (input) =>
      Effect.sync(() => {
        const target = shelves.get(input.projectID)
        const stored = target?.byName.get(input.name)
        if (!target || !stored) return false
        target.byName.delete(input.name)
        index(target)
        return true
      }),
    allow: (input) =>
      Effect.sync(() => {
        shelves.get(input.projectID)?.byName.get(input.name)?.allowed.add(input.destination)
      }),
    scrub: (projectID, text) => Effect.sync(() => clean(projectID)(text)),
    scrubber: (projectID) => Effect.sync(() => clean(projectID)),
    references,
  })
}

export const layer = Layer.sync(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

/** The binding a tool call for `projectID` runs under. */
export const bind = (vault: Interface, projectID: Project.ID): Binding => ({
  projectID,
  resolve: (name) => vault.resolve({ projectID, name }),
  scrub: (text) => vault.scrub(projectID, text),
  scrubber: vault.scrubber(projectID),
  capture: (texts, hosts) =>
    Effect.gen(function* () {
      const known = yield* vault.scrubber(projectID)
      const names = yield* Effect.forEach(
        texts.flatMap((text) => capturable(known(text))),
        (item) => vault.put({ projectID, kind: item.kind, value: item.value, hosts }),
      )
      return { clean: yield* vault.scrubber(projectID), names: Array.from(new Set(names)) }
    }),
  set: (input) => vault.set({ projectID, ...input }),
  hosts: (names) =>
    vault
      .list(projectID)
      .pipe(
        Effect.map(
          (entries) =>
            new Map(names.map((name) => [name, entries.find((entry) => entry.name === name)?.hosts ?? []] as const)),
        ),
      ),
  allow: (name, destination) => vault.allow({ projectID, name, destination }),
})

const ESCAPE = /[.*+?^${}()|[\]\\]/g

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

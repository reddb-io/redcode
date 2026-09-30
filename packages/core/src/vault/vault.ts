export * as Vault from "./vault.js"

import { Clock, Context, Effect, Layer } from "effect"
import { Project } from "@opencode/schema/project"
import { Definition, Entry, Moved, reference, sanitize } from "@opencode/schema/vault"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Redact } from "@opencode/util/redact"
import { VaultDotenv } from "./dotenv.js"
import { VaultEnvFile } from "./env-file.js"

/**
 * The project vault: secrets moved out of a conversation, which the model only ever sees as `{vault:<name>}`.
 *
 * A secret belongs to exactly one project, the Session's `Project.ID`, which every worktree of a repository shares.
 * Another project cannot list, resolve or scrub with it, and there is no global scope to fall back to. Sharing with
 * another project is a later, explicit grant that `resolve` and `list` will check; callers keep passing the project
 * that asks.
 *
 * A project's secrets live in the `.env` file at the root of its repository, git ignored, which is the project's own
 * convention: the vault hydrates from it, so `GITHUB_TOKEN` there is `{vault:github-token}` here, and writes what the
 * user pastes, sets or is asked for back to it. A value the model captured from a tool's output is short-lived and
 * stays in this process's memory only, as does every value while no directory is attached. The interface is what a
 * global, encrypted store replaces without changing callers. A value leaves the vault only through `resolve`, at an
 * execution sink; nothing here logs or publishes one.
 */

export { Definition, Entry, Moved, reference, sanitize }

/**
 * Where a secret came from, which decides what a new value under a taken name does: the user's own `set` replaces
 * it, a value the model captured under a name replaces only another captured value, and a request never replaces.
 */
export type Origin = "pasted" | "user" | "requested" | "captured" | "env"

export interface Interface {
  /** The name of `value` in the project, stored under a new `<kind>-<n>` name unless it is already there. */
  readonly put: (input: {
    readonly projectID: Project.ID
    readonly kind: string
    readonly value: string
    /** The name the text called it, such as the variable it was assigned to; used when no other value holds it. */
    readonly name?: string
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
  /**
   * Tells the vault where the project's `.env` is, from any directory of its Session, and reads it. Without it the
   * project's secrets stay in memory. Calling it again, also with another directory, is harmless.
   */
  readonly attach: (input: { readonly projectID: Project.ID; readonly directory: string }) => Effect.Effect<void>
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

type Stored = Entry & {
  readonly value: string
  readonly origin: Origin
  readonly allowed: Set<string>
  /** Whether the project's `.env` holds it, so a change to the file changes it and a `forget` edits the file. */
  readonly persisted: boolean
  /** Whether its value is replaced in text; a `.env` value that is no secret, such as `PORT`, must not be. */
  readonly scrub: boolean
}

type Shelf = {
  readonly byName: Map<string, Stored>
  readonly byValue: Map<string, string>
  /** Only grows, so a forgotten name is never reused for another value that old references would then reach. */
  readonly counters: Map<string, number>
  /** The `.env` text last read and when, so an unchanged file costs nothing and the file is read at most once a tick. */
  env: { text: string | undefined; checked: number }
  /** Every value, longest first, so a value that contains another is replaced whole; undefined for an empty shelf. */
  pattern: RegExp | undefined
}

/** A `.env` variable named like a credential, which is what makes a short or unrecognized value worth scrubbing. */
const CREDENTIAL_NAME = /key|token|secret|passw|pwd|credential|auth|private|dsn|salt|signature|cert/i

/**
 * A vault over `env`, the project's `.env` files; without one every value stays in this process's memory. `layer`
 * provides one over the file system, and tests build their own. `refreshMs` is how long a read of the file is trusted.
 */
export const make = (env?: VaultEnvFile.Store, options: { readonly refreshMs?: number } = {}): Interface => {
  const refreshMs = options.refreshMs ?? 1000
  const shelves = new Map<Project.ID, Shelf>()
  const directories = new Map<Project.ID, string>()
  const shelf = (projectID: Project.ID) => {
    const existing = shelves.get(projectID)
    if (existing) return existing
    const created: Shelf = {
      byName: new Map(),
      byValue: new Map(),
      counters: new Map(),
      pattern: undefined,
      env: { text: undefined, checked: Number.NEGATIVE_INFINITY },
    }
    shelves.set(projectID, created)
    return created
  }
  // Rebuilt on every change: a value two names hold is scrubbed to the older one, whichever of them changes.
  const index = (target: Shelf) => {
    target.byValue.clear()
    target.byName.forEach((stored) => {
      if (stored.scrub && !target.byValue.has(stored.value)) target.byValue.set(stored.value, stored.name)
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
  // The project's `.env` folded into the shelf: what the file holds replaces what the shelf took from it before,
  // while a value never written to the file, such as a captured token, stays as it is.
  const refresh = Effect.fn("Vault.refresh")(function* (projectID: Project.ID) {
    const directory = directories.get(projectID)
    if (!env || directory === undefined) return
    const target = shelf(projectID)
    const now = yield* Clock.currentTimeMillis
    if (now - target.env.checked < refreshMs) return
    target.env.checked = now
    const text = yield* env.read(directory)
    if (text === target.env.text) return
    target.env.text = text
    const found = new Map(
      VaultDotenv.parse(text ?? "").entries.flatMap((entry) => {
        const name = sanitize(entry.name)
        return name === "" ? [] : [[name, { variable: entry.name, value: entry.value }] as const]
      }),
    )
    target.byName.forEach((stored, name) => {
      if (stored.persisted && !found.has(name)) target.byName.delete(name)
    })
    found.forEach((entry, name) => {
      const held = target.byName.get(name)
      if (held && !held.persisted) return
      if (held?.value === entry.value) return
      target.byName.set(name, {
        name,
        kind: held?.kind ?? "env",
        created: held?.created ?? now,
        value: entry.value,
        origin: held?.origin ?? "env",
        allowed: held?.allowed ?? new Set(),
        persisted: true,
        scrub:
          held?.scrub ??
          (entry.value.length >= MIN_LENGTH &&
            (CREDENTIAL_NAME.test(entry.variable) || capturable(entry.value).length > 0)),
      })
    })
    index(target)
  })
  // Writes what the user gave, not what a tool printed, to the `.env`; a refused write leaves it in memory.
  const persist = Effect.fn("Vault.persist")(function* (projectID: Project.ID, target: Shelf, name: string) {
    const stored = target.byName.get(name)
    const directory = directories.get(projectID)
    if (!env || directory === undefined || !stored || stored.origin === "captured") return
    const written = yield* env.update(directory, (text) => VaultEnvFile.upsert(text, name, stored.value))
    if (written) target.byName.set(name, { ...stored, persisted: true })
  })
  const store = Effect.fn("Vault.store")(function* (
    projectID: Project.ID,
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
      persisted: false,
      scrub: true,
    })
    index(target)
    yield* persist(projectID, target, input.name)
    return input.name
  })

  return Service.of({
    attach: Effect.fn("Vault.attach")(function* (input) {
      if (input.projectID === Project.ID.global) return
      if (directories.get(input.projectID) !== input.directory)
        shelf(input.projectID).env.checked = Number.NEGATIVE_INFINITY
      directories.set(input.projectID, input.directory)
      yield* refresh(input.projectID)
    }),
    put: Effect.fn("Vault.put")(function* (input) {
      yield* refresh(input.projectID)
      const target = shelf(input.projectID)
      const existing = target.byValue.get(input.value)
      if (existing !== undefined) {
        input.hosts?.forEach((host) => target.byName.get(existing)?.allowed.add(host))
        return existing
      }
      const kind = sanitize(input.kind).slice(0, 48).replace(/-$/, "") || "secret"
      const preferred = sanitize(input.name ?? "")
      const held = preferred === "" ? undefined : target.byName.get(preferred)
      if (held?.value === input.value) return held.name
      return yield* store(input.projectID, target, {
        name: preferred !== "" && held === undefined ? preferred : nextName(target, kind),
        kind,
        value: input.value,
        origin: "pasted",
        hosts: input.hosts,
      })
    }),
    set: Effect.fn("Vault.set")(function* (input) {
      yield* refresh(input.projectID)
      const target = shelf(input.projectID)
      const kind =
        sanitize(input.kind ?? input.name)
          .slice(0, 48)
          .replace(/-$/, "") || "secret"
      const asked = sanitize(input.name)
      const held = asked ? target.byName.get(asked) : undefined
      if (held?.value === input.value) {
        input.hosts?.forEach((host) => held.allowed.add(host))
        return held.name
      }
      const replaces =
        held === undefined || input.origin === "user" || (input.origin === "captured" && held.origin === "captured")
      const name = asked === "" ? nextName(target, kind) : replaces ? asked : nextName(target, asked)
      return yield* store(input.projectID, target, {
        name,
        kind,
        value: input.value,
        origin: input.origin,
        hosts: input.hosts,
      })
    }),
    resolve: Effect.fn("Vault.resolve")(function* (input) {
      yield* refresh(input.projectID)
      return shelves.get(input.projectID)?.byName.get(input.name)?.value
    }),
    list: Effect.fn("Vault.list")(function* (projectID) {
      yield* refresh(projectID)
      return Array.from(shelves.get(projectID)?.byName.values() ?? [], (stored) =>
        Entry.make({
          name: stored.name,
          kind: stored.kind,
          created: stored.created,
          ...(stored.allowed.size === 0 ? {} : { hosts: Array.from(stored.allowed).toSorted() }),
        }),
      )
    }),
    forget: Effect.fn("Vault.forget")(function* (input) {
      yield* refresh(input.projectID)
      const target = shelves.get(input.projectID)
      const stored = target?.byName.get(input.name)
      const directory = directories.get(input.projectID)
      if (!target || !stored) return false
      target.byName.delete(input.name)
      index(target)
      if (env && directory !== undefined && stored.persisted)
        yield* env.update(directory, (text) => VaultEnvFile.remove(text, input.name))
      return true
    }),
    allow: (input) =>
      Effect.sync(() => {
        shelves.get(input.projectID)?.byName.get(input.name)?.allowed.add(input.destination)
      }),
    scrub: (projectID, text) => refresh(projectID).pipe(Effect.map(() => clean(projectID)(text))),
    scrubber: (projectID) => refresh(projectID).pipe(Effect.map(() => clean(projectID))),
    references,
  })
}

export const layer = Layer.sync(Service, () => make(VaultEnvFile.store()))

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

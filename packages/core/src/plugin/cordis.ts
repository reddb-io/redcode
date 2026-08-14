export * as CordisPluginHost from "./cordis"

import { Context, type Fiber } from "@deepseek-ai/cordis"
import type { Plugin as PluginRuntime } from "@opencode-ai/plugin/v2/effect"
import { Effect, Exit, Semaphore } from "effect"
import { PluginV2 } from "../plugin"

export interface ProfileEntry {
  readonly id: PluginV2.ID
  readonly effect: PluginRuntime["effect"]
}

export interface Profile {
  readonly name: string
  readonly entries: readonly ProfileEntry[]
}

export interface ProfileSnapshot {
  readonly name?: string
  readonly entries: readonly PluginV2.ID[]
}

export interface Interface {
  readonly apply: (profile: Profile) => Effect.Effect<void>
  readonly clear: Effect.Effect<void>
  readonly snapshot: Effect.Effect<ProfileSnapshot>
  readonly dump: Effect.Effect<string>
}

export const make = Effect.fn("CordisPluginHost.make")(function* (plugins: PluginV2.Interface) {
  const context = new Context()
  const semaphore = yield* Semaphore.make(1)
  const active = new Map<PluginV2.ID, { entry: ProfileEntry; fiber: Fiber }>()
  let name: string | undefined

  const dispose = (entries: Iterable<{ fiber: Fiber }>) =>
    Promise.all(Array.from(entries, (entry) => entry.fiber.dispose())).then(() => undefined)

  const mount = (entry: ProfileEntry) => {
    const fiber = context.plugin(() =>
      Effect.runPromise(plugins.add(entry.id, entry.effect)).then(
        () => () => Effect.runPromise(plugins.remove(entry.id)),
      ),
    )
    return Promise.resolve(fiber).then(
      () => ({ entry, fiber }),
      (error) => fiber.dispose().then(() => Promise.reject(error)),
    )
  }

  const replace = (profile: Profile) =>
    dispose(active.values()).then(() => {
      active.clear()
      name = undefined
      return profile.entries
        .reduce(
          (pending, entry) =>
            pending.then(() =>
              mount(entry).then((mounted) => {
                active.set(entry.id, mounted)
              }),
            ),
          Promise.resolve(),
        )
        .then(() => {
          name = profile.name
        })
    })

  const apply = (profile: Profile) => {
    const ids = profile.entries.map((entry) => entry.id)
    if (new Set(ids).size !== ids.length) return Effect.die(`Cordis profile ${profile.name} contains duplicate ids`)

    return semaphore.withPermits(1)(
      Effect.gen(function* () {
        const previous = { name: name ?? "previous", entries: Array.from(active.values(), (item) => item.entry) }
        const result = yield* Effect.promise(() => replace(profile)).pipe(Effect.exit)
        if (Exit.isSuccess(result)) return
        yield* Effect.promise(() => replace(previous))
        yield* result
      }),
    )
  }

  const clear = semaphore.withPermits(1)(
    Effect.promise(() =>
      dispose(active.values()).then(() => {
        active.clear()
        name = undefined
      }),
    ),
  )
  const snapshot = Effect.sync(() => ({ name, entries: Array.from(active.keys()) }))
  const dump = snapshot.pipe(Effect.map((value) => JSON.stringify(value, undefined, 2)))

  yield* Effect.addFinalizer(() => clear)

  return {
    apply,
    clear,
    snapshot,
    dump,
  } satisfies Interface
})

export * as CordisPluginHost from "./cordis"

import { Context, type Fiber } from "@deepseek-ai/cordis"
import type { Plugin as PluginRuntime } from "@reddb-io/redcode-plugin/v2/effect"
import { Effect, Exit, Semaphore } from "effect"
import { PluginV2 } from "../plugin"
import { State } from "../state"

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
  let active: { profile: Profile; fiber: Fiber } | undefined

  const mount = (profile: Profile) => {
    const fiber = context.plugin(() =>
      Effect.runPromise(
        State.batch(
          Effect.forEach(profile.entries, (entry) => plugins.add(entry.id, entry.effect), { discard: true }),
        ).pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            return State.batch(
              Effect.forEach(profile.entries, (entry) => plugins.remove(entry.id), { discard: true }),
            )
          }),
        ),
      ).then(
        () => () =>
          Effect.runPromise(
            State.batch(
              Effect.forEach(profile.entries, (entry) => plugins.remove(entry.id), { discard: true }),
            ),
          ),
      ),
    )
    return Promise.resolve(fiber).then(
      () => ({ profile, fiber }),
      (error) => fiber.dispose().then(() => Promise.reject(error)),
    )
  }

  const replace = (profile: Profile) =>
    Promise.resolve(active?.fiber.dispose()).then(() => {
      active = undefined
      return mount(profile).then((mounted) => {
        active = mounted
      })
    })

  const apply = (profile: Profile) => {
    const ids = profile.entries.map((entry) => entry.id)
    if (new Set(ids).size !== ids.length) return Effect.die(`Cordis profile ${profile.name} contains duplicate ids`)

    return semaphore.withPermits(1)(
      Effect.gen(function* () {
        const previous = active?.profile
        const result = yield* Effect.promise(() => replace(profile)).pipe(Effect.exit)
        if (Exit.isSuccess(result)) return
        if (previous) yield* Effect.promise(() => replace(previous))
        yield* result
      }),
    )
  }

  const clear = semaphore.withPermits(1)(
    Effect.promise(() =>
      Promise.resolve(active?.fiber.dispose()).then(() => {
        active = undefined
      }),
    ),
  )
  const snapshot = Effect.sync(() => ({
    name: active?.profile.name,
    entries: active?.profile.entries.map((entry) => entry.id) ?? [],
  }))
  const dump = snapshot.pipe(Effect.map((value) => JSON.stringify(value, undefined, 2)))

  yield* Effect.addFinalizer(() => clear)

  return {
    apply,
    clear,
    snapshot,
    dump,
  } satisfies Interface
})

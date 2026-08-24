export * as CapabilityRegistry from "./registry"

import { Context, Effect, Layer, Scope } from "effect"
import type { Registration } from "../state"
import { makeLocationNode } from "../effect/app-node"
import { Filesystem } from "./filesystem"
import { ProcessService } from "./process"
import { ShellService } from "./shell"

/**
 * Capability registration registry.
 *
 * Plugins use this to install additional backends for filesystem, shell, and
 * subprocess. Each `register` returns a `Registration` whose `dispose` runs on
 * scope exit; consumers never see the registry directly.
 *
 * LSP lives in the Redcode server because `LSP.Service` is bound there; the
 * equivalent V2 hook is wired into the server-side host, not core.
 */

export type FilesystemBackend = Filesystem.Backend
export type ShellBackend = ShellService.Backend
export type ProcessBackend = ProcessService.Backend

export type FilesystemEntry = { readonly name: string; readonly backend: FilesystemBackend }
export type ShellEntry = { readonly name: string; readonly backend: ShellBackend }
export type ProcessEntry = { readonly name: string; readonly backend: ProcessBackend }

export interface Interface {
  readonly filesystem: {
    readonly list: () => ReadonlyArray<FilesystemEntry>
    readonly register: (backend: FilesystemBackend) => Effect.Effect<Registration, never, Scope.Scope>
  }
  readonly shell: {
    readonly list: () => ReadonlyArray<ShellEntry>
    readonly register: (backend: ShellBackend) => Effect.Effect<Registration, never, Scope.Scope>
  }
  readonly process: {
    readonly list: () => ReadonlyArray<ProcessEntry>
    readonly register: (backend: ProcessBackend) => Effect.Effect<Registration, never, Scope.Scope>
  }
}

export class Service extends Context.Service<Service, Interface>()("@redcode/v2/Capability") {}

interface RegistryState {
  readonly filesystem: Map<string, FilesystemBackend>
  readonly shell: Map<string, ShellBackend>
  readonly process: Map<string, ProcessBackend>
}

const emptyRegistry = (): RegistryState => ({
  filesystem: new Map(),
  shell: new Map(),
  process: new Map(),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Effect.sync(emptyRegistry)

    const registerOne = <K extends "filesystem" | "shell" | "process">(
      key: K,
      backend: FilesystemBackend | ShellBackend | ProcessBackend,
    ): Effect.Effect<Registration, never, Scope.Scope> =>
      Effect.gen(function* () {
        const map = state[key] as Map<string, typeof backend>
        const name = (backend as { name: string }).name
        if (map.has(name)) {
          return { dispose: Effect.void }
        }
        map.set(name, backend)
        return {
          dispose: Effect.sync(() => {
            map.delete(name)
          }),
        }
      })

    return Service.of({
      filesystem: {
        list: () => Array.from(state.filesystem, ([name, backend]) => ({ name, backend })),
        register: (backend: FilesystemBackend) => registerOne("filesystem", backend),
      },
      shell: {
        list: () => Array.from(state.shell, ([name, backend]) => ({ name, backend })),
        register: (backend: ShellBackend) => registerOne("shell", backend),
      },
      process: {
        list: () => Array.from(state.process, ([name, backend]) => ({ name, backend })),
        register: (backend: ProcessBackend) => registerOne("process", backend),
      },
    })
  }),
)

export const layerOnly = layer

const noopLayer: Layer.Layer<Service> = Layer.succeed(Service, {
  filesystem: {
    list: () => [],
    register: () => Effect.succeed({ dispose: Effect.void }),
  },
  shell: {
    list: () => [],
    register: () => Effect.succeed({ dispose: Effect.void }),
  },
  process: {
    list: () => [],
    register: () => Effect.succeed({ dispose: Effect.void }),
  },
})

export const defaultLayer = Layer.merge(layer, noopLayer)
export const node = makeLocationNode({ service: Service, layer: defaultLayer, deps: [] })

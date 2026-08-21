import type { Effect, Scope } from "effect"

export interface CapabilityRegistration {
  readonly dispose: Effect.Effect<void>
}

export interface FilesystemBackendSpec {
  readonly name: string
  readonly label: string
  readonly accepts: (location: string) => boolean
}

export interface ShellBackendSpec {
  readonly name: string
  readonly label: string
  readonly accepts: (location: string) => boolean
}

export interface ProcessBackendSpec {
  readonly name: string
  readonly label: string
  readonly accepts: (location: string) => boolean
}

export interface CapabilityHooks {
  readonly filesystem: {
    readonly list: () => ReadonlyArray<{ readonly name: string; readonly spec: FilesystemBackendSpec }>
    readonly register: (
      backend: FilesystemBackendSpec,
    ) => Effect.Effect<CapabilityRegistration, never, Scope.Scope>
  }
  readonly shell: {
    readonly list: () => ReadonlyArray<{ readonly name: string; readonly spec: ShellBackendSpec }>
    readonly register: (
      backend: ShellBackendSpec,
    ) => Effect.Effect<CapabilityRegistration, never, Scope.Scope>
  }
  readonly process: {
    readonly list: () => ReadonlyArray<{ readonly name: string; readonly spec: ProcessBackendSpec }>
    readonly register: (
      backend: ProcessBackendSpec,
    ) => Effect.Effect<CapabilityRegistration, never, Scope.Scope>
  }
}

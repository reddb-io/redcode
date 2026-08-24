import type { ChildProcess } from "child_process"
import { Context, Effect, Layer, Schema } from "effect"
import * as Shell from "../shell"

/**
 * Capability seam: shell.
 *
 * Encapsulates the per-OS shell quirks (login rc files, quoting, kill-tree)
 * behind a service so a remote backend can swap the local `child_process`
 * implementation for one that targets another host. Tools (`shell`, `bash`)
 * go through `ShellService` and never import `shell.ts` directly.
 */

export namespace ShellService {
  export class BackendError extends Schema.TaggedErrorClass<BackendError>()("ShellBackendError", {
    backend: Schema.String,
    method: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }) {
    override get message() {
      const detail = this.cause instanceof Error ? this.cause.message : this.cause && String(this.cause)
      return `Shell backend "${this.backend}" failed: ${this.method}${detail ? `: ${detail}` : ""}`
    }
  }

  export interface Interface {
    readonly preferred: (configShell?: string) => string
    readonly acceptable: (configShell?: string) => string | undefined
    readonly list: () => Effect.Effect<Shell.Item[], BackendError>
    readonly args: (shell: string, command: string, cwd: string) => string[]
    readonly killTree: (proc: ChildProcess, opts?: { exited?: () => boolean }) => Effect.Effect<void, BackendError>
  }

  export interface Backend {
    readonly name: string
    readonly label: string
    readonly accepts: (location: string) => boolean
    readonly build: () => Layer.Layer<Service>
  }

  export class Service extends Context.Service<Service, Interface>()("@redcode/Shell") {}

  /** `Backend` describes provider implementations; consumers depend on `Service`. */
  export type BackendTag = Backend

  /**
   * Local backend wraps the existing `Shell` helpers; a remote backend
   * (`"ssh"`, `"docker"`) would route `args`/`killTree` over the wire and
   * keep `preferred` honest with whatever shell the host exposes.
   */
  export const Local: Backend = {
    name: "local",
    label: "Local shell",
    accepts: () => true,
    build: () => LocalLayer,
  }

  /**
   * `LocalLayer` wraps the existing `Shell` module so callers go through the
   * seam tag. `killTree` becomes Effect-returning by adapting the existing
   * async implementation.
   */
  export const LocalLayer: Layer.Layer<Service> = Layer.succeed(Service, {
    preferred: (configShell?: string) => Shell.preferred(configShell) as string,
    acceptable: (configShell?: string) => Shell.acceptable(configShell),
    list: () =>
      Effect.tryPromise({
        try: () => Shell.list(),
        catch: (cause) => new BackendError({ backend: "local", method: "list", cause }),
      }),
    args: (shell: string, command: string, cwd: string) => Shell.args(shell, command, cwd),
    killTree: (proc, opts) =>
      Effect.tryPromise({
        try: () => Shell.killTree(proc, opts),
        catch: (cause) => new BackendError({ backend: "local", method: "killTree", cause }),
      }),
  })
}

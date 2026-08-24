import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { FSUtil } from "../fs-util"
import { Glob } from "../util/glob"

/**
 * Capability seam: filesystem.
 *
 * A backend implements the operations that tools and core services consume
 * locally. A plugin can register a second backend (e.g. remote over HTTP or
 * container exec) and consumers keep talking to `Filesystem.Service`.
 *
 * The seam intentionally mirrors `FSUtil.Interface` minus the few Node-only
 * helpers that have no portable meaning (mime lookup, `findUp` heuristics).
 * Backends are expected to satisfy the same shape so callers do not branch.
 */

export namespace Filesystem {
  export class BackendError extends Schema.TaggedErrorClass<BackendError>()("FilesystemBackendError", {
    backend: Schema.String,
    method: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }) {
    override get message() {
      const detail = this.cause instanceof Error ? this.cause.message : this.cause && String(this.cause)
      return `Filesystem backend "${this.backend}" failed: ${this.method}${detail ? `: ${detail}` : ""}`
    }
  }

  export type Error = PlatformError | BackendError

  export interface Interface extends FileSystem.FileSystem {
    readonly isDir: (path: string) => Effect.Effect<boolean, never>
    readonly isFile: (path: string) => Effect.Effect<boolean, never>
    readonly existsSafe: (path: string) => Effect.Effect<boolean, never>
    readonly readFileStringSafe: (path: string) => Effect.Effect<string | undefined, Error>
    readonly readJson: (path: string) => Effect.Effect<unknown, Error>
    readonly writeJson: (path: string, data: unknown, mode?: number) => Effect.Effect<void, Error>
    readonly ensureDir: (path: string) => Effect.Effect<void, Error>
    readonly writeWithDirs: (path: string, content: string | Uint8Array, mode?: number) => Effect.Effect<void, Error>
    readonly readDirectoryEntries: (path: string) => Effect.Effect<FSUtil.DirEntry[], Error>
    readonly resolve: (path: string) => Effect.Effect<string>
    readonly glob: (pattern: string, options?: Glob.Options) => Effect.Effect<string[], Error>
    readonly globMatch: (pattern: string, filepath: string) => boolean
  }

  /** A backend describes itself, picks the locations it serves, and supplies the interface. */
  export interface Backend {
    readonly name: string
    readonly label: string
    readonly accepts: (location: string) => boolean
    readonly build: () => Layer.Layer<Service>
  }

  export class Service extends Context.Service<Service, Interface>()("@redcode/Filesystem") {}

  /** Re-exported as a service tag; `Backend` describes provider implementations. */
  export const BackendTag = Service;

  /**
   * `Local` is the Node-backed implementation. It delegates to `FSUtil` and
   * accepts every location; remote backends should advertise a tighter
   * `accepts` predicate so the registry can chain them.
   *
   * Wired up in Phase 1 once the `FSUtil.node` layer is plumbed through
   * the seam; the shape below is what consumers will register.
   */
  export const Local: Backend = {
    name: "local",
    label: "Local filesystem",
    accepts: () => true,
    build: () => LocalLayer,
  }

  /**
   * `LocalLayer` re-exposes `FSUtil.Service` as a `Filesystem.Service`. Both
   * interfaces extend `FileSystem.FileSystem` with the same helpers, so the
   * cast stays inside the project; consumers go through the seam tag and
   * never reach `FSUtil.Service` directly.
   */
  export const LocalLayer: Layer.Layer<Service> = Layer.succeed(
    Service,
    FSUtil.Service as unknown as Interface,
  )
}

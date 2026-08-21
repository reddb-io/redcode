import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Context, Duration, Effect, Layer, Schema, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { AppProcess } from "../process"

/**
 * Capability seam: subprocess.
 *
 * Wraps `AppProcess` so consumers (shell tool, hook runner, session prompt,
 * plugin loader) talk to one service and remote backends can substitute a
 * different `ChildProcessSpawner` without touching the call sites.
 */

export namespace ProcessService {
  export class BackendError extends Schema.TaggedErrorClass<BackendError>()("ProcessBackendError", {
    backend: Schema.String,
    method: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }) {
    override get message() {
      const detail = this.cause instanceof Error ? this.cause.message : this.cause && String(this.cause)
      return `Process backend "${this.backend}" failed: ${this.method}${detail ? `: ${detail}` : ""}`
    }
  }

  export interface RunOptions {
    readonly combineOutput?: boolean
    readonly maxOutputBytes?: number
    readonly maxErrorBytes?: number
    readonly signal?: AbortSignal
    readonly timeout?: Duration.Input
    readonly stdin?: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError>
  }

  export interface RunStreamOptions {
    readonly signal?: AbortSignal
    readonly includeStderr?: boolean
    readonly okExitCodes?: ReadonlyArray<number>
    readonly maxErrorBytes?: number
  }

  export interface RunResult {
    readonly command: string
    readonly exitCode: number
    readonly output?: Buffer
    readonly stdout: Buffer
    readonly stderr: Buffer
    readonly outputTruncated?: boolean
    readonly stdoutTruncated: boolean
    readonly stderrTruncated: boolean
  }

  export type Interface = ChildProcessSpawner["Service"] & {
    readonly run: (command: ChildProcess.Command, options?: RunOptions) => Effect.Effect<RunResult, AppProcess.AppProcessError>
    readonly runStream: (
      command: ChildProcess.Command,
      options?: RunStreamOptions,
    ) => Stream.Stream<string, AppProcess.AppProcessError>
  }

  export interface Backend {
    readonly name: string
    readonly label: string
    readonly accepts: (location: string) => boolean
    readonly build: () => Layer.Layer<Service>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Process") {}

  /** `Backend` describes provider implementations; consumers depend on `Service`. */
  export type BackendTag = Backend

  export const Local: Backend = {
    name: "local",
    label: "Local subprocess",
    accepts: () => true,
    build: () => LocalLayer,
  }

  /**
   * `LocalLayer` exposes the opencode `AppProcess.Service` as the
   * `ProcessService.Service`. The interface is identical; the cast is
   * the seam boundary.
   */
  export const LocalLayer: Layer.Layer<Service> = Layer.succeed(
    Service,
    AppProcess.Service as unknown as Interface,
  )
}

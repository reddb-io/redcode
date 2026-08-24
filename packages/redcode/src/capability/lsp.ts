import { Context, Effect, Layer, Schema } from "effect"
import { LSP } from "../lsp/lsp"

/**
 * Capability seam: language server protocol.
 *
 * Wraps the Redcode `LSP` service so consumers (`tool/read`, `tool/write`,
 * `tool/edit`, `tool/apply_patch`, `tool/lsp`) route through one interface
 * and remote backends (e.g. an SSH-tunnelled language server) can plug in
 * without touching tool code.
 */

export namespace LSPService {
  export class BackendError extends Schema.TaggedErrorClass<BackendError>()("LSPBackendError", {
    backend: Schema.String,
    method: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }) {
    override get message() {
      const detail = this.cause instanceof Error ? this.cause.message : this.cause && String(this.cause)
      return `LSP backend "${this.backend}" failed: ${this.method}${detail ? `: ${detail}` : ""}`
    }
  }

  export type Interface = LSP.Interface

  export interface Backend {
    readonly name: string
    readonly label: string
    readonly accepts: (location: string) => boolean
    readonly build: () => Layer.Layer<Service>
  }

  export class Service extends Context.Service<Service, Interface>()("@redcode/LSP") {}

  /** `Backend` describes provider implementations; consumers depend on `Service`. */
  export type BackendTag = Backend

  export const Local: Backend = {
    name: "local",
    label: "Local language servers",
    accepts: () => true,
    build: () => LocalLayer,
  }

  /** `LocalLayer` exposes the Redcode `LSP.Service` as the `LSPService.Service`. */
  export const LocalLayer: Layer.Layer<Service> = Layer.succeed(
    Service,
    LSP.Service as unknown as Interface,
  )
}

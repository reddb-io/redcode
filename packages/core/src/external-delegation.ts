export * as ExternalDelegation from "./external-delegation.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export type Target = "codex" | "claude"
export type Request = { requestID: string; driver: Target; task: string }
export interface Adapter {
  delegate: (sessionID: string, directory: string, request: Request) => Promise<unknown>
  status: (sessionID: string, taskID: string) => unknown
  cancel: (sessionID: string, taskID: string) => Promise<unknown>
}

export class Service extends Context.Service<
  Service,
  { set: (adapter: Adapter | undefined) => void; get: () => Adapter | undefined }
>()("@opencode/ExternalDelegation") {}

export const layer = Layer.sync(Service, () => {
  let adapter: Adapter | undefined
  return Service.of({
    set: (value) => {
      adapter = value
    },
    get: () => adapter,
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

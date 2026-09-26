export * as DesignAppConnection from "./app-connection.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { DesignApp } from "./app.js"

export interface Interface {
  readonly connect: (version?: string) => Promise<DesignApp.Connection>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignAppConnection") {}

export const configured = (input: {
  readonly host: () => DesignApp.Host | undefined
  readonly database?: string
}) =>
  makeGlobalNode({
    service: Service,
    layer: Layer.succeed(Service, Service.of({
      connect: async (version) => {
        const host = input.host()
        if (!host || !input.database)
          throw new Error("The design app needs a listening redcode server and a file-backed database")
        const { DesignApp } = await import("./app.js")
        return DesignApp.connect({ host, database: input.database, version })
      },
    })),
    deps: [],
  })

export const node = configured({ host: () => undefined })

export * as DesignAppConnection from "./app-connection.js"

import { Context, Layer } from "effect"
import path from "node:path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { DesignApp } from "./app.js"
import type { Database } from "../database/database.js"

export interface Interface {
  readonly connect: () => Promise<DesignApp.Connection>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignAppConnection") {}

export const configured = (input: {
  readonly host: () => DesignApp.Host | undefined
  readonly database?: Database.Options
}) =>
  makeGlobalNode({
    service: Service,
    layer: Layer.succeed(Service, Service.of({
      connect: async () => {
        const host = input.host()
        if (!host || (!input.database?.url && !path.isAbsolute(input.database?.path ?? "")))
          throw new Error("The design app needs a listening redcode server and a persistent database")
        const { DesignApp } = await import("./app.js")
        return DesignApp.connect({ host, database: input.database })
      },
    })),
    deps: [],
  })

export const node = configured({ host: () => undefined })

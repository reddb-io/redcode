import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { WorkerLease } from "@opencode/core/worker-lease"
import { ConflictError } from "@opencode/protocol/errors"
import { Api } from "../api"

export const WorkerLeaseHandler = HttpApiBuilder.group(Api, "server.workerLease", (handlers) =>
  Effect.gen(function* () {
    const leases = yield* WorkerLease.Service
    const conflict = (error: WorkerLease.Conflict) =>
      new ConflictError({ message: error.message, resource: "worker-lease" })
    return handlers
      .handle("workerLease.acquire", (ctx) => leases.acquire(ctx.payload).pipe(Effect.mapError(conflict)))
      .handle("workerLease.renew", (ctx) => leases.renew(ctx.payload).pipe(Effect.mapError(conflict)))
      .handle("workerLease.release", (ctx) => leases.release(ctx.payload).pipe(Effect.mapError(conflict)))
  }),
)

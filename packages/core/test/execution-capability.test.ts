import { expect, test } from "bun:test"
import { ExecutionCapability as Contract } from "@opencode/schema/execution-capability"
import { ExecutionCapability } from "@opencode/core/execution-capability"
import { Effect, Exit, Scope } from "effect"

const capability = (name: string) =>
  Contract.Info.make({
    id: Contract.ID.make("browser:session"),
    name,
    kind: "browser",
    source: "builtin",
    status: "ready",
    risk: "interactive",
    target: { type: "client", id: name, name },
    operations: ["observe"],
  })

test("capability leases disappear with their owner and stale owners cannot remove replacements", async () => {
  const service = ExecutionCapability.make()
  const first = await Effect.runPromise(Scope.make())
  const second = await Effect.runPromise(Scope.make())

  await Effect.runPromise(service.lease(capability("first")).pipe(Effect.provideService(Scope.Scope, first)))
  expect((await Effect.runPromise(service.list())).map((item) => item.name)).toEqual(["first"])

  await Effect.runPromise(service.lease(capability("second")).pipe(Effect.provideService(Scope.Scope, second)))
  await Effect.runPromise(Scope.close(first, Exit.void))
  expect((await Effect.runPromise(service.list())).map((item) => item.name)).toEqual(["second"])

  await Effect.runPromise(Scope.close(second, Exit.void))
  expect(await Effect.runPromise(service.list())).toEqual([])
})

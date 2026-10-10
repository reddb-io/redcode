import { expect } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("two paired clients share host files and sessions without copying them to the client", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const server = yield* startServer(directory.path)
    const host = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    const anonymous = OpenCode.make({ baseUrl: server.base })
    const clients = yield* Effect.promise(() =>
      Promise.all(
        [1, 2].map(async () => {
          const grant = await host.server.pair()
          const session = await anonymous.server.connect({ code: grant.code })
          return OpenCode.make({
            baseUrl: server.base,
            headers: { authorization: `Basic ${btoa(`opencode:${session.token}`)}` },
          })
        }),
      ),
    )
    const first = clients[0]!
    const second = clients[1]!
    const location = { directory: directory.path }
    const content = new TextEncoder().encode("Edited from the first device\n")
    yield* Effect.promise(() => first.file.write({ location, path: "remote.txt", payload: content }))
    // The host owns the file. The second client reads the same bytes through the API.
    expect(yield* Effect.promise(() => Bun.file(`${directory.path}/remote.txt`).text())).toBe(
      "Edited from the first device\n",
    )
    expect(yield* Effect.promise(() => second.file.read({ location, path: "remote.txt" }))).toEqual(content)
    const session = yield* Effect.promise(() => first.session.create({ location, title: "Shared remote work" }))
    expect((yield* Effect.promise(() => second.session.get({ sessionID: session.id }))).title).toBe(
      "Shared remote work",
    )
    yield* Effect.promise(() =>
      second.session.update({ sessionID: session.id, title: "Renamed from the second device" }),
    )
    expect((yield* Effect.promise(() => first.session.get({ sessionID: session.id }))).title).toBe(
      "Renamed from the second device",
    )
    const refused = yield* Effect.promise(() =>
      fetch(`${server.base}/api/fs/read/remote.txt?location[directory]=${encodeURIComponent(directory.path)}`),
    )
    expect(refused.status).toBe(401)
    yield* Effect.promise(() => refused.arrayBuffer())
  }),
)

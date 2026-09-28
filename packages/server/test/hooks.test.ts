import { expect } from "bun:test"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live(
  "trusted hooks reject prompts before durable admission and revoke restores admission",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const script = `${tmp.path}/deny.cjs`
      yield* Effect.promise(() => Bun.write(script, "process.stderr.write('Denied by project policy');process.exit(2)"))
      const handler = yield* ServerFetch.make(
        {
          app: { version: "test" },
          database: { path: ":memory:" },
          fs: { filewatcher: false },
          models: { fetch: false },
          config: {
            project: false,
            global: false,
            content: JSON.stringify({
              hooks: {
                UserPromptSubmit: [
                  {
                    hooks: [
                      { type: "command", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` },
                    ],
                  },
                ],
              },
            }),
          },
          password: "secret",
        },
        { overrides: [Global.node.replace(Global.layerWith({ state: `${tmp.path}/state` }))] },
      )
      const location = `?location[directory]=${encodeURIComponent(tmp.path)}`
      const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
      const request = (path: string, method = "GET", body?: unknown) =>
        Effect.promise(async () => {
          const response = await handler(
            new Request(`http://opencode.local/api${path}`, {
              method,
              headers,
              body: body === undefined ? undefined : JSON.stringify(body),
            }),
          )
          return { status: response.status, body: await response.json() }
        })
      const unauthorized = yield* Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/hook${location}`)),
      )
      expect(unauthorized.status).toBe(401)
      expect(yield* request(`/hook${location}`)).toMatchObject({
        status: 200,
        body: { data: { trust: { trusted: false } } },
      })
      expect(yield* request(`/hook/trust${location}`, "POST")).toMatchObject({
        status: 200,
        body: { data: { trusted: true } },
      })
      expect(yield* request("/session", "POST", { id: "ses_hooks", location: { directory: tmp.path } })).toMatchObject({
        status: 200,
      })
      expect(
        yield* request("/session/ses_hooks/prompt", "POST", {
          id: "msg_blocked",
          text: "should be denied",
          resume: false,
        }),
      ).toMatchObject({ status: 400, body: { message: "Denied by project policy" } })
      expect(yield* request("/session/ses_hooks/inbox")).toMatchObject({ status: 200, body: { data: [] } })
      expect(yield* request(`/hook/trust${location}`, "DELETE")).toMatchObject({
        status: 200,
        body: { data: { trusted: false } },
      })
      expect(
        yield* request("/session/ses_hooks/prompt", "POST", { id: "msg_accepted", text: "admitted", resume: false }),
      ).toMatchObject({ status: 200 })
      // An idempotent retry must not rerun hooks after trust changes.
      expect(yield* request(`/hook/trust${location}`, "POST")).toMatchObject({ status: 200 })
      expect(
        yield* request("/session/ses_hooks/prompt", "POST", { id: "msg_accepted", text: "retry", resume: false }),
      ).toMatchObject({ status: 200 })
      yield* request(`/hook/trust${location}`, "DELETE")
    }).pipe(Effect.scoped),
  { timeout: 30_000 },
)

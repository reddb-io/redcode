/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { createRedcodeClient } from "@reddb-io/redcode-sdk/v2"
import { loadSessionRoute } from "../../src/util/session-navigation"
import { json } from "../fixture/tui-sdk"
import { wait } from "../cli/cmd/tui/sync-fixture"

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("a stale navigation cannot reset the current workspace/editor even if its transport ignores abort", async () => {
  const first = deferred()
  const second = deferred()
  const requests: Request[] = []
  const fetcher: typeof fetch = Object.assign(
    async (input: string | URL | Request) => {
      if (!(input instanceof Request)) throw new Error("SDK must supply Request")
      requests.push(input)
      return new URL(input.url).pathname.endsWith("ses_a") ? first.promise : second.promise
    },
    { preconnect: fetch.preconnect },
  )
  const client = createRedcodeClient({ baseUrl: "http://test", fetch: fetcher })
  const [route, setRoute] = createSignal("ses_a")
  const workspaces: Array<string | undefined> = []
  const editors: string[] = []
  const synced: string[] = []
  const ready: string[] = []
  const loads: Promise<void>[] = []
  function Probe() {
    createEffect(() => {
      const sessionID = route()
      const abort = new AbortController()
      onCleanup(() => abort.abort())
      loads.push(
        loadSessionRoute({
          sessionID,
          signal: abort.signal,
          current: () => !abort.signal.aborted && route() === sessionID,
          client,
          workspace: undefined,
          setWorkspace: (id) => {
            workspaces.push(id)
          },
          bootstrap: async () => {},
          reconnect: (directory) => {
            editors.push(directory)
          },
          sync: async (id) => {
            synced.push(id)
          },
          ready: () => {
            ready.push(sessionID)
          },
        }),
      )
    })
    return <box />
  }
  const app = await testRender(() => <Probe />)
  try {
    await wait(() => requests.length === 1)
    setRoute("ses_b")
    await wait(() => requests.length === 2)
    expect(requests[0].signal.aborted).toBe(true)
    second.resolve(json({ id: "ses_b", workspaceID: "ws_b", directory: "/workspace/b" }))
    await wait(() => ready.length === 1)
    first.resolve(json({ id: "ses_a", workspaceID: "ws_a", directory: "/workspace/a" }))
    await Promise.all(loads)
    expect(workspaces).toEqual(["ws_b"])
    expect(editors).toEqual(["/workspace/b"])
    expect(synced).toEqual(["ses_b"])
    expect(ready).toEqual(["ses_b"])
  } finally {
    app.renderer.destroy()
  }
})

/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { SDKProvider, useSDK } from "../../../src/context/sdk"
import { json } from "../../fixture/tui-sdk"
import { wait } from "../cmd/tui/sync-fixture"

test("snapshots wait for an actual event on every connection, including a lazy reconnect stream", async () => {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  let snapshots = 0
  const fetcher: typeof fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname === "/session/status") {
        snapshots++
        return json({})
      }
      if (url.pathname !== "/global/event") throw new Error(`Unexpected endpoint: ${url.pathname}`)
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller)
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
    { preconnect: fetch.preconnect },
  )
  function Probe() {
    const sdk = useSDK()
    onCleanup(
      sdk.onReconnect(() => {
        void sdk.client.session.status()
      }),
    )
    return <box />
  }
  const app = await testRender(() => (
    <SDKProvider url="http://test" fetch={fetcher}>
      <Probe />
    </SDKProvider>
  ))
  const connected = new TextEncoder().encode(
    `data: ${JSON.stringify({ directory: "global", payload: { id: "evt_connected", type: "server.connected", properties: {} } })}\n\n`,
  )
  try {
    await wait(() => streams.length === 1)
    expect(snapshots).toBe(0)
    streams[0].enqueue(connected)
    await wait(() => snapshots === 1)
    streams[0].close()
    await wait(() => streams.length === 2)
    await Bun.sleep(30)
    expect(snapshots).toBe(1)
    streams[1].enqueue(connected)
    await wait(() => snapshots === 2)
  } finally {
    app.renderer.destroy()
    streams.at(-1)?.close()
  }
})

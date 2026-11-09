import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createClientConnection } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const connected = { id: "evt_connected", created: 1, type: "server.connected", data: {} }

// One fake server whose event streams stay open until the test writes to them or the client aborts.
function server() {
  const encoder = new TextEncoder()
  const streams: {
    request: Request
    write: (text: string) => void
    close: () => void
    aborted: boolean
  }[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (request.method === "POST") return new Response(null, { status: 200 })
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const entry = {
        request,
        write: (text: string) => controller.enqueue(encoder.encode(text)),
        close: () => controller.close(),
        aborted: false,
      }
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
        },
        cancel() {
          entry.aborted = true
        },
      })
      request.signal.addEventListener("abort", () => {
        entry.aborted = true
        controller.error(request.signal.reason)
      })
      streams.push(entry)
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { api, streams }
}

test("reconnects from the last consumed global stream cursor", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  const handshake = (cursor: number, replayed: number) => ({
    ...connected,
    id: `evt_connected_${cursor}`,
    data: { stream: { epoch: "process-one", cursor, replayed, reset: false } },
  })
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(handshake(0, 0))}\n\n`)
    fake.streams[0].write(`id: process-one:1\ndata: ${JSON.stringify({ ...connected, id: "evt_live" })}\n\n`)
    await until(() => ctx.events.some((event) => event.id === "evt_live"))
    fake.streams[0].close()

    await until(() => fake.streams.length === 2)
    expect(fake.streams[1].request.url).toBe(
      "http://opencode.local/api/event?epoch=process-one&cursor=1",
    )
    fake.streams[1].write(`data: ${JSON.stringify(handshake(1, 0))}\n\n`)
    await until(() => ctx.connection.status() === "connected")
  } finally {
    ctx.dispose()
  }
})

test("coalesces adjacent ephemeral model deltas before rendering", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  const delta = (id: string, value: string) => ({
    id,
    created: 2,
    type: "session.text.delta",
    data: { sessionID: "ses_one", assistantMessageID: "msg_one", ordinal: 0, delta: value },
  })
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(
      `data: ${JSON.stringify(connected)}\n\n` +
        `data: ${JSON.stringify(delta("evt_one", "hello "))}\n\n` +
        `data: ${JSON.stringify(delta("evt_two", "world"))}\n\n`,
    )

    await until(() => ctx.events.length === 2)
    expect(ctx.events[1]).toMatchObject({
      id: "evt_two",
      type: "session.text.delta",
      data: { delta: "hello world" },
    })
  } finally {
    ctx.dispose()
  }
})

function setup(input: ReturnType<typeof server>, idleTimeout: number) {
  const events: OpenCodeEvent[] = []
  return createRoot((dispose) => ({
    events,
    dispose,
    connection: createClientConnection(input.api, {
      idleTimeout,
      flushInterval: 0,
      onEvent: (event) => events.push(event),
    }),
  }))
}

async function until(check: () => boolean, timeout = 2_000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test("a stream that goes silent past the idle timeout is replaced", async () => {
  const fake = server()
  const ctx = setup(fake, 60)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    await until(() => fake.streams.length === 2)
    expect(fake.streams[0].aborted).toBe(true)
    expect(ctx.connection.internal.history().map((item) => item.data)).toContainEqual({
      status: "disconnected",
      attempt: 1,
      error: "Event stream stalled",
    })

    fake.streams[1].write(`data: ${JSON.stringify({ ...connected, id: "evt_connected_2" })}\n\n`)
    await until(() => ctx.connection.status() === "connected" && ctx.events.length === 2)
    expect(ctx.connection.error()).toBeUndefined()
  } finally {
    ctx.dispose()
  }
})

test("keepalive comments hold a quiet stream open", async () => {
  const fake = server()
  const ctx = setup(fake, 60)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    const heartbeat = setInterval(() => fake.streams[0].write(": heartbeat\n\n"), 20)
    await new Promise((resolve) => setTimeout(resolve, 250))
    clearInterval(heartbeat)

    expect(fake.streams).toHaveLength(1)
    expect(fake.streams[0].aborted).toBe(false)
    expect(ctx.connection.status()).toBe("connected")
    expect(ctx.events).toHaveLength(1)
  } finally {
    ctx.dispose()
  }
})

test("a slow first event does not trigger repeated connection attempts", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    await until(() => fake.streams.length === 1)
    await Bun.sleep(3000)
    expect(fake.streams[0].aborted).toBe(false)
    expect(fake.streams).toHaveLength(1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")
  } finally {
    ctx.dispose()
  }
}, 10_000)

test("a forced resync replaces the stream immediately and only while connected", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    ctx.connection.internal.resync("too early")
    await until(() => fake.streams.length === 1)
    expect(fake.streams[0].aborted).toBe(false)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    const started = Date.now()
    ctx.connection.internal.resync("Network connection restored")
    await until(() => fake.streams.length === 2)
    expect(Date.now() - started).toBeLessThan(500)
    expect(fake.streams[0].aborted).toBe(true)
    expect(ctx.connection.internal.history().map((item) => item.data)).toContainEqual({
      status: "disconnected",
      attempt: 1,
      error: "Network connection restored",
    })
    fake.streams[1].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")
  } finally {
    ctx.dispose()
  }
})

test("a stream the server closes reconnects and reports the disconnect", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    fake.streams[0].close()
    await until(() => ctx.connection.status() === "reconnecting")
    expect(ctx.connection.error()).toBe("Event stream disconnected")
    await until(() => fake.streams.length === 2)
  } finally {
    ctx.dispose()
  }
})

test("a managed endpoint resolver does not bypass backoff when the event stream keeps closing", async () => {
  const fake = server()
  const ctx = createRoot((dispose) => ({
    dispose,
    connection: createClientConnection(fake.api, {
      reconnect: async () => fake.api,
      idleTimeout: 10_000,
      onEvent: () => {},
    }),
  }))
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")
    fake.streams[0].close()
    await until(() => ctx.connection.status() === "reconnecting")
    await Bun.sleep(150)
    expect(fake.streams).toHaveLength(1)
    await until(() => fake.streams.length === 2)
    fake.streams[1].close()
    await Bun.sleep(1200)
    expect(fake.streams).toHaveLength(2)
    await until(() => fake.streams.length === 3)
  } finally {
    ctx.dispose()
  }
}, 10_000)

import { describe, expect, test } from "bun:test"
import { authTokenFromCredentials, CAPABILITIES_HEADER, createApiForServer, MEDIA_URI_CAPABILITY } from "./api"
import { ClientPresence } from "@opencode/schema/client-presence"

test("authTokenFromCredentials ignores usernames in legacy saved credentials", () => {
  const credentials = { username: "legacy", password: "secret" }
  expect(authTokenFromCredentials(credentials)).toBe(btoa("opencode:secret"))
})

describe("media capability", () => {
  test("opts message reads in while leaving unrelated requests untouched", async () => {
    const requests: Request[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      if (request.url.endsWith("/api/info"))
        return Response.json({ version: "test", pid: 1, urls: [], paths: { tmp: "/tmp" } })
      return Response.json({ data: [], cursor: {} })
    }) as typeof globalThis.fetch
    const api = createApiForServer({ server: { url: "http://redcode.test" }, fetch })

    await api.message.list({ sessionID: "ses_test", order: "asc" })
    await api.server.info()

    expect(requests[0]!.headers.get(CAPABILITIES_HEADER)).toBe(MEDIA_URI_CAPABILITY)
    expect(requests[1]!.headers.get(CAPABILITIES_HEADER)).toBeNull()
  })

  test("can force self-contained reads for export and accepts legacy inline responses", async () => {
    const requests: Request[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      return Response.json({
        data: [
          {
            id: "msg_test",
            type: "user",
            text: "legacy",
            files: [{ data: "aGk=", mime: "text/plain", source: { type: "inline" } }],
            time: { created: 1 },
          },
        ],
        cursor: {},
      })
    }) as typeof globalThis.fetch
    const api = createApiForServer({ server: { url: "http://legacy.test" }, fetch })

    const page = await api.message.list({ sessionID: "ses_test" }, { mediaRefs: false })

    expect(requests[0]!.headers.get(CAPABILITIES_HEADER)).toBeNull()
    expect(page.data[0]).toMatchObject({ type: "user", files: [{ data: "aGk=" }] })
  })
})

test("identifies the desktop or web client on every server request", async () => {
  let request: Request | undefined
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = input instanceof Request ? input : new Request(input, init)
    return Response.json({ version: "test", pid: 1, urls: [], paths: { tmp: "/tmp" } })
  }) as typeof globalThis.fetch
  const api = createApiForServer({
    server: { url: "http://redcode.test" },
    fetch,
    client: { id: "window-one", surface: "desktop", version: "0.1.0" },
  })

  await api.server.info()

  expect(request?.headers.get(ClientPresence.CLIENT_ID_HEADER)).toBe("window-one")
  expect(request?.headers.get(ClientPresence.SURFACE_HEADER)).toBe("desktop")
  expect(request?.headers.get(ClientPresence.VERSION_HEADER)).toBe("0.1.0")
})

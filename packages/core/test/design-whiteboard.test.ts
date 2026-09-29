import { afterEach, expect, test } from "bun:test"
import path from "node:path"
import { DesignWhiteboard } from "@opencode/core/design/whiteboard"
import { tmpdir } from "./fixture/tmpdir"

afterEach(() => DesignWhiteboard.configure({ fetch: globalThis.fetch, offline: false }))

test("with downloads disabled a missing bundle is unavailable and nothing is fetched", async () => {
  await using tmp = await tmpdir()
  const requested: string[] = []
  DesignWhiteboard.configure({
    data: tmp.path,
    checkout: path.join(tmp.path, "checkout"),
    directory: undefined,
    offline: true,
    fetch: async (url) => {
      requested.push(url)
      return new Response(null, { status: 404 })
    },
  })
  const failure = await DesignWhiteboard.frame("9.9.9").then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toMatchObject({
    code: "unavailable",
    message: expect.stringContaining("REDCODE_DISABLE_WHITEBOARD_DOWNLOAD"),
  })
  expect(requested).toEqual([])
})

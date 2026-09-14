import { describe, expect, test } from "bun:test"
import { DesignReviewPresence } from "@reddb-io/redcode-core/design/review-presence"
import { openDesignReview } from "../../src/routes/session/design-review"

const review = "http://127.0.0.1:4096/design/session/ses_a/review"

/** The server's launch, release and open routes over a real presence; nothing launches a browser. */
function server(input: { launchRoute?: boolean } = {}) {
  const presence = DesignReviewPresence.make()
  const calls: string[] = []
  const fetch = async (url: URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`)
    if (url.pathname === "/design/session/ses_a/launch" && input.launchRoute !== false)
      return Response.json({ url: review, ...presence.claim("ses_a", { explicit: body.explicit === true }) })
    if (url.pathname === "/design/session/ses_a/launch/release") {
      presence.release("ses_a", body.token)
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/design/session/ses_a/open") return Response.json({ url: review })
    return new Response(null, { status: 404 })
  }
  return { presence, calls, fetch }
}

const launcher = (result: boolean) => {
  const launched: string[] = []
  return {
    launched,
    launch: async (url: string) => {
      launched.push(url)
      return result
    },
  }
}

describe("TUI Open Design review", () => {
  test("opens once, then reports the connected page instead of opening a duplicate", async () => {
    const remote = server()
    const browser = launcher(true)
    const open = () =>
      openDesignReview({
        sessionID: "ses_a",
        base: "http://127.0.0.1:4096",
        fetch: remote.fetch,
        launch: browser.launch,
      })
    expect(await open()).toBeUndefined()
    expect(browser.launched).toEqual([review])
    // The agent publishes before the page connects: the server holds the TUI's claim.
    expect(remote.presence.claim("ses_a").outcome).toBe("pending")
    remote.presence.connect("ses_a")
    const notice = await open()
    expect(notice).toEqual({
      variant: "info",
      message: `The Design review is already open in a browser tab; switch to it there (the terminal cannot focus it). ${review}`,
    })
    expect(browser.launched).toEqual([review])
  })

  test("a failed launch releases the server claim and shows the URL", async () => {
    const remote = server()
    const browser = launcher(false)
    const notice = await openDesignReview({
      sessionID: "ses_a",
      base: "http://127.0.0.1:4096",
      fetch: remote.fetch,
      launch: browser.launch,
    })
    expect(notice).toEqual({ variant: "error", message: `Could not open a browser. Design review: ${review}` })
    expect(remote.calls).toEqual(["POST /design/session/ses_a/launch", "POST /design/session/ses_a/launch/release"])
    expect(remote.presence.claim("ses_a").outcome).toBe("claimed")
  })

  test("without the launch route, or with launches disabled, the notice still carries the URL", async () => {
    const remote = server({ launchRoute: false })
    const browser = launcher(true)
    const base = { sessionID: "ses_a", base: "http://127.0.0.1:4096", fetch: remote.fetch, launch: browser.launch }
    expect((await openDesignReview(base))?.message).toBe(
      `Could not ask the server to open the Design review. Design review: ${review}`,
    )
    expect(await openDesignReview({ ...base, disabled: "REDCODE_NO_BROWSER" })).toEqual({
      variant: "info",
      message: `Browser launch is disabled by REDCODE_NO_BROWSER. Design review: ${review}`,
    })
    expect(browser.launched).toEqual([])
  })
})

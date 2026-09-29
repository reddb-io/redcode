import { describe, expect, test } from "bun:test"
import { openDesignReview } from "../src/routes/session/design-review"

const endpoint = { url: "http://127.0.0.1:4096", headers: { authorization: "Basic test" } }
const review = "http://127.0.0.1:4096/design/session/ses_a/review?ticket=signed"

/** Answers the launch claim with fixed replies and records every call; nothing launches a browser. */
function server(replies: readonly unknown[]) {
  const calls: string[] = []
  const queue = [...replies]
  const fetch = async (url: URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url.pathname} ${String(init?.body ?? "")}`.trim())
    if (url.pathname === "/design/session/ses_a/link") return Response.json({ url: review, connected: 0 })
    const reply = url.pathname === "/design/session/ses_a/launch" ? queue.shift() : { released: true }
    return reply === undefined ? new Response(null, { status: 404 }) : Response.json(reply)
  }
  return { calls, fetch }
}

function browser(opens: boolean) {
  const launched: string[] = []
  return {
    launched,
    launch: async (url: string) => {
      launched.push(url)
      if (!opens) throw new Error("no browser")
    },
  }
}

describe("openDesignReview", () => {
  test("a granted claim opens the review once; a connected page is reported instead of a second tab", async () => {
    const remote = server([
      { outcome: "claimed", token: 1, url: review, connected: 0 },
      { outcome: "connected", url: review, connected: 1 },
    ])
    const opener = browser(true)
    const open = () =>
      openDesignReview({
        sessionID: "ses_a",
        endpoint,
        explicit: true,
        disabled: false,
        fetch: remote.fetch,
        launch: opener.launch,
      })
    expect(await open()).toBeUndefined()
    expect(await open()).toEqual({
      variant: "info",
      message: `The Design review is already open in a browser tab; switch to it there (the terminal cannot focus it). ${review}`,
    })
    expect(opener.launched).toEqual([review])
    expect(remote.calls).toEqual([
      'POST /design/session/ses_a/launch {"explicit":true}',
      'POST /design/session/ses_a/launch {"explicit":true}',
    ])
  })

  test("a publish stays quiet while a tab was just requested", async () => {
    const remote = server([{ outcome: "pending", url: review, connected: 0 }])
    const opener = browser(true)
    const notice = await openDesignReview({
      sessionID: "ses_a",
      endpoint,
      explicit: false,
      disabled: false,
      fetch: remote.fetch,
      launch: opener.launch,
    })
    expect(notice).toBeUndefined()
    expect(opener.launched).toEqual([])
    expect(remote.calls).toEqual(['POST /design/session/ses_a/launch {"explicit":false}'])
  })

  test("a failed launch gives the claim back and shows the URL", async () => {
    const remote = server([{ outcome: "claimed", token: 7, url: review, connected: 0 }])
    const notice = await openDesignReview({
      sessionID: "ses_a",
      endpoint,
      explicit: false,
      disabled: false,
      fetch: remote.fetch,
      launch: browser(false).launch,
    })
    expect(notice).toEqual({ variant: "error", message: `Could not open a browser. Design review: ${review}` })
    expect(remote.calls).toEqual([
      'POST /design/session/ses_a/launch {"explicit":false}',
      'POST /design/session/ses_a/launch/release {"token":7}',
    ])
  })

  test("with launches disabled nothing is claimed and the link is shown", async () => {
    const remote = server([])
    const opener = browser(true)
    const notice = await openDesignReview({
      sessionID: "ses_a",
      endpoint,
      explicit: false,
      disabled: true,
      fetch: remote.fetch,
      launch: opener.launch,
    })
    expect(notice).toEqual({
      variant: "info",
      message: `Browser launch is disabled by REDCODE_NO_BROWSER. Design review: ${review}`,
    })
    expect(opener.launched).toEqual([])
    expect(remote.calls).toEqual(["GET /design/session/ses_a/link"])
  })

  test("a server without launch claims opens its plain link", async () => {
    const remote = server([])
    const opener = browser(true)
    const notice = await openDesignReview({
      sessionID: "ses_a",
      endpoint,
      explicit: true,
      disabled: false,
      fetch: remote.fetch,
      launch: opener.launch,
    })
    expect(notice).toBeUndefined()
    expect(opener.launched).toEqual([review])
  })
})

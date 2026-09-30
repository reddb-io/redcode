import { describe, expect, test } from "bun:test"
import { getDesignReviewLink, openDesignReview } from "./design-review.js"

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
  test("reportOpened returns a persistent address even on loopback and never opens a connected review twice", async () => {
    const remote = server([
      { outcome: "claimed", token: 1, url: review },
      { outcome: "connected", url: review },
    ])
    const opener = browser(true)
    const open = () =>
      openDesignReview({
        sessionID: "ses_a",
        endpoint,
        explicit: false,
        reportOpened: true,
        fetch: remote.fetch,
        launch: opener.launch,
      })
    expect((await open())?.url).toBe(review)
    expect((await open())?.url).toBe(review)
    expect(opener.launched).toEqual([review])
    expect(await getDesignReviewLink({ sessionID: "ses_a", endpoint, fetch: remote.fetch })).toEqual({ url: review })
    expect(opener.launched).toEqual([review])
  })
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
        fetch: remote.fetch,
        launch: opener.launch,
      })
    expect(await open()).toBeUndefined()
    expect(await open()).toEqual({
      variant: "info",
      message: `The Design review is already open in a browser tab; switch to it there. ${review}`,
      url: review,
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
      fetch: remote.fetch,
      launch: browser(false).launch,
    })
    expect(notice).toEqual({
      variant: "error",
      message: `Could not open a browser. Design review: ${review}`,
      url: review,
    })
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
      disabledBy: "REDCODE_NO_BROWSER",
      fetch: remote.fetch,
      launch: opener.launch,
    })
    expect(notice).toEqual({
      variant: "info",
      message: `Browser launch is disabled by REDCODE_NO_BROWSER. Design review: ${review}`,
      url: review,
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
      fetch: remote.fetch,
      launch: opener.launch,
    })
    expect(notice).toBeUndefined()
    expect(opener.launched).toEqual([review])
  })

  test("a refused claim falls back to the plain link, and a failed launch there shows it", async () => {
    const remote = server([])
    const notice = await openDesignReview({
      sessionID: "ses_a",
      endpoint,
      explicit: true,
      fetch: remote.fetch,
      launch: browser(false).launch,
    })
    expect(notice).toEqual({
      variant: "error",
      message: `Could not open a browser. Design review: ${review}`,
      url: review,
    })
    expect(remote.calls).toEqual([
      'POST /design/session/ses_a/launch {"explicit":true}',
      "GET /design/session/ses_a/link",
    ])
  })

  test("a review with a network address names it after an announced launch and in every notice", async () => {
    const network = "http://192.168.1.20:4096/design/session/ses_a/review?ticket=signed"
    const remote = server([
      { outcome: "claimed", token: 1, url: review, network, connected: 0 },
      { outcome: "connected", url: review, network, connected: 1 },
    ])
    const opener = browser(true)
    const open = () =>
      openDesignReview({
        sessionID: "ses_a",
        endpoint,
        explicit: true,
        reportOpened: true,
        fetch: remote.fetch,
        launch: opener.launch,
      })
    expect(await open()).toEqual({
      variant: "info",
      message: `Design review: ${review}\nOn another device: ${network}`,
      url: review,
      network,
    })
    expect(await open()).toEqual({
      variant: "info",
      message: `The Design review is already open in a browser tab; switch to it there. ${review}\nOn another device: ${network}`,
      url: review,
      network,
    })
  })

  test("a launch stays quiet without a network address even when announced", async () => {
    const remote = server([{ outcome: "claimed", token: 1, url: review, connected: 0 }])
    const notice = await openDesignReview({
      sessionID: "ses_a",
      endpoint,
      explicit: true,
      reportOpened: true,
      fetch: remote.fetch,
      launch: browser(true).launch,
    })
    expect(notice).toBeUndefined()
  })
})

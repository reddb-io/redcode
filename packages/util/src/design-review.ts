import { Option, Schema } from "effect"

export interface Notice {
  readonly variant: "info" | "error"
  readonly message: string
  /** The review link, when the server gave one, so a surface can offer to open it by hand. */
  readonly url?: string
  /** The same review for another device on the network, when the server listens beyond loopback. */
  readonly network?: string
}

const Claim = Schema.Struct({
  outcome: Schema.Literals(["claimed", "connected", "pending"]),
  token: Schema.optional(Schema.Number),
  url: Schema.String,
  network: Schema.optional(Schema.String),
})
const Link = Schema.Struct({ url: Schema.String, network: Schema.optional(Schema.String) })

/** Read a stable review address without launching a browser. */
export async function getDesignReviewLink(input: {
  readonly sessionID: string
  readonly endpoint: { readonly url: string; readonly headers?: Record<string, string> }
  readonly fetch?: (url: URL, init?: RequestInit) => Promise<Response>
}) {
  return (input.fetch ?? fetch)(
    new URL(`/design/session/${encodeURIComponent(input.sessionID)}/link`, input.endpoint.url),
    { headers: input.endpoint.headers },
  )
    .then(async (response) =>
      response.ok ? Option.getOrUndefined(Schema.decodeUnknownOption(Link)(await response.json())) : undefined,
    )
    .catch(() => undefined)
}

/**
 * Opens a Session's Design review in a browser at most once per review, from any surface (TUI, CLI, web or
 * desktop app). The launch is claimed on the server, which counts connected review pages and sees every
 * client's claims: no duplicate tab, a publish right after a request opens no second one, and a launch that
 * opens no browser gives its claim back. `explicit` is the user's request; a publish (`explicit: false`)
 * stays quiet unless something failed. Returns the notice to show, if any; every notice carries the review
 * URL so the user can open it by hand. It never launches anything itself: `launch` does.
 */
export async function openDesignReview(input: {
  readonly sessionID: string
  readonly endpoint: { readonly url: string; readonly headers?: Record<string, string> }
  readonly explicit: boolean
  /** The variable forbidding browser launches (such as `REDCODE_NO_BROWSER`); nothing is claimed then. */
  readonly disabledBy?: string
  /** Opens the URL in a browser; rejects when none opened. */
  readonly launch: (url: string) => Promise<unknown>
  /** After a successful launch, return an info notice naming the network address when the review has one. */
  readonly reportOpened?: boolean
  readonly fetch?: (url: URL, init?: RequestInit) => Promise<Response>
}): Promise<Notice | undefined> {
  const request = input.fetch ?? fetch
  const root = `/design/session/${encodeURIComponent(input.sessionID)}`
  const post = (path: string, body: unknown) =>
    request(new URL(`${root}${path}`, input.endpoint.url), {
      method: "POST",
      headers: { ...input.endpoint.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  const link = () => getDesignReviewLink(input)
  const unreachable: Notice = { variant: "error", message: "Could not ask the server for the Design review link." }
  const notice = (variant: Notice["variant"], message: string, review: { url: string; network?: string }): Notice => ({
    variant,
    message: review.network ? `${message}\nOn another device: ${review.network}` : message,
    url: review.url,
    ...(review.network ? { network: review.network } : {}),
  })
  const failed = (review: { url: string; network?: string }) =>
    notice("error", `Could not open a browser. Design review: ${review.url}`, review)
  const opened = (review: { url: string; network?: string }) =>
    input.reportOpened ? notice("info", `Design review: ${review.url}`, review) : undefined
  if (input.disabledBy) {
    const review = await link()
    return review
      ? notice("info", `Browser launch is disabled by ${input.disabledBy}. Design review: ${review.url}`, review)
      : unreachable
  }
  const claim = await post("/launch", { explicit: input.explicit })
    .then(async (response) =>
      response.ok ? Option.getOrUndefined(Schema.decodeUnknownOption(Claim)(await response.json())) : undefined,
    )
    .catch(() => undefined)
  if (!claim) {
    // A server without launch claims (or one refusing this client's claim) cannot count review pages;
    // open its plain link as before.
    const review = await link()
    if (!review) return unreachable
    return input.launch(review.url).then(
      () => opened(review),
      () => failed(review),
    )
  }
  if (claim.outcome === "connected")
    return input.explicit || input.reportOpened
      ? notice("info", `The Design review is already open in a browser tab; switch to it there. ${claim.url}`, claim)
      : undefined
  if (claim.outcome === "pending")
    return input.explicit || input.reportOpened
      ? notice(
          "info",
          `A Design review tab was just requested, or a review page just closed; no new tab was opened. Design review: ${claim.url}`,
          claim,
        )
      : undefined
  if (
    await input.launch(claim.url).then(
      () => true,
      () => false,
    )
  )
    return opened(claim)
  if (claim.token !== undefined) await post("/launch/release", { token: claim.token }).catch(() => undefined)
  return failed(claim)
}

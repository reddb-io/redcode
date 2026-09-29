import { Option, Schema } from "effect"
import { NO_BROWSER } from "@opencode/util/open"

export interface Notice {
  readonly variant: "info" | "error"
  readonly message: string
}

const Claim = Schema.Struct({
  outcome: Schema.Literals(["claimed", "connected", "pending"]),
  token: Schema.optional(Schema.Number),
  url: Schema.String,
})
const Link = Schema.Struct({ url: Schema.String })

/**
 * Opens a Session's Design review in the browser at most once per review. The launch is claimed on the
 * server, which counts connected review pages and sees every client's claims: no duplicate tab, a publish
 * right after a request opens no second one, and a launch that opens no browser gives its claim back.
 * `explicit` is the user's request; a publish (`explicit: false`) stays quiet unless something failed.
 * Returns the toast to show, if any; every notice carries the review URL so the user can open it by hand.
 */
export async function openDesignReview(input: {
  readonly sessionID: string
  readonly endpoint: { readonly url: string; readonly headers?: Record<string, string> }
  readonly explicit: boolean
  /** Whether `REDCODE_NO_BROWSER` forbids launches; nothing is claimed then. */
  readonly disabled: boolean
  /** Opens the URL in a browser; rejects when none opened. */
  readonly launch: (url: string) => Promise<unknown>
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
  const link = () =>
    request(new URL(`${root}/link`, input.endpoint.url), { headers: input.endpoint.headers })
      .then(async (response) =>
        response.ok ? Option.getOrUndefined(Schema.decodeUnknownOption(Link)(await response.json()))?.url : undefined,
      )
      .catch(() => undefined)
  const unreachable: Notice = { variant: "error", message: "Could not ask the server for the Design review link." }
  if (input.disabled) {
    const url = await link()
    return url
      ? { variant: "info", message: `Browser launch is disabled by ${NO_BROWSER}. Design review: ${url}` }
      : unreachable
  }
  const claim = await post("/launch", { explicit: input.explicit })
    .then(async (response) =>
      response.ok ? Option.getOrUndefined(Schema.decodeUnknownOption(Claim)(await response.json())) : undefined,
    )
    .catch(() => undefined)
  if (!claim) {
    // A server without launch claims cannot count review pages; open its plain link as before.
    const url = await link()
    if (!url) return unreachable
    return input.launch(url).then(
      () => undefined,
      () => ({ variant: "error" as const, message: `Could not open a browser. Design review: ${url}` }),
    )
  }
  if (claim.outcome === "connected")
    return input.explicit
      ? {
          variant: "info",
          message: `The Design review is already open in a browser tab; switch to it there (the terminal cannot focus it). ${claim.url}`,
        }
      : undefined
  if (claim.outcome === "pending")
    return input.explicit
      ? {
          variant: "info",
          message: `A Design review tab was just requested, or a review page just closed; no new tab was opened. Design review: ${claim.url}`,
        }
      : undefined
  if (
    await input.launch(claim.url).then(
      () => true,
      () => false,
    )
  )
    return undefined
  if (claim.token !== undefined) await post("/launch/release", { token: claim.token }).catch(() => undefined)
  return { variant: "error", message: `Could not open a browser. Design review: ${claim.url}` }
}

import { DesignReviewPresence } from "@reddb-io/redcode-core/design/review-presence"

export interface Notice {
  readonly variant: "info" | "error"
  readonly message: string
}

/**
 * The "Open Design review" command. The launch is claimed on the server, which counts connected review
 * pages and sees the Design tool's publishes: no duplicate tab, a publish right after this opens no
 * second one, and a launch that opens no browser gives its claim back. Returns the toast to show, if
 * any; every notice carries the review URL so the user can open it by hand.
 */
export async function openDesignReview(input: {
  readonly sessionID: string
  /** The server the TUI talks to. */
  readonly base: string
  readonly fetch: (url: URL, init?: RequestInit) => Promise<Response>
  readonly headers?: RequestInit["headers"]
  /** The variable forbidding browser launches, if one is set. */
  readonly disabled?: string
  readonly launch: (url: string) => Promise<boolean>
}): Promise<Notice | undefined> {
  const root = `/design/session/${input.sessionID}`
  const post = (path: string, body: unknown) => {
    const headers = new Headers(input.headers)
    headers.set("content-type", "application/json")
    return input.fetch(new URL(path, input.base), { method: "POST", headers, body: JSON.stringify(body) })
  }
  const result = await DesignReviewPresence.openExplicit({
    sessionID: input.sessionID,
    disabled: input.disabled,
    claim: async () => {
      const response = await post(`${root}/launch`, { explicit: true })
      return response.ok ? DesignReviewPresence.parseClaim(await response.json()) : undefined
    },
    release: (token) => post(`${root}/launch/release`, { token }),
    launch: input.launch,
  })
  if (result.status === "opened") return undefined
  const url =
    result.url ??
    (await input
      .fetch(new URL(`${root}/open`, input.base), { headers: input.headers })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((value: { url?: unknown } | undefined) => (typeof value?.url === "string" ? value.url : undefined))
      .catch(() => undefined)) ??
    new URL(`${root}/review`, input.base).toString()
  const notices: Record<Exclude<DesignReviewPresence.Explicit, "opened">, Notice> = {
    disabled: { variant: "info", message: `Browser launch is disabled by ${input.disabled}. Design review: ${url}` },
    connected: {
      variant: "info",
      message: `The Design review is already open in a browser tab; switch to it there (the terminal cannot focus it). ${url}`,
    },
    pending: {
      variant: "info",
      message: `A Design review tab was just requested, or a review page just closed; no new tab was opened. Design review: ${url}`,
    },
    failed: { variant: "error", message: `Could not open a browser. Design review: ${url}` },
    unavailable: {
      variant: "error",
      message: `Could not ask the server to open the Design review. Design review: ${url}`,
    },
  }
  return notices[result.status]
}

import { showToast } from "@opencode/ui/toast"
import { openDesignReview } from "@opencode/util/design-review"
import type { SetupContext } from "../sdk"
import type Design from "./index"

/** The server address and credentials a review claim is made with. */
export interface DesignEndpoint {
  /** The server's base URL. */
  readonly url: string
  /** The HTTP basic password the user configured, if any. */
  readonly password?: string
}

/**
 * Opens a session's Design review in a browser. The review link carries a short-lived ticket, so it is requested on
 * each open instead of cached. The launch is claimed on the server like the TUI's, so a review open elsewhere is
 * reported instead of doubled.
 */
export function createDesignReview(ctx: SetupContext<typeof Design>) {
  return (sessionID: string, server: DesignEndpoint) => {
    // A browser lets a click open a tab only before its first await, so the web app opens an empty tab now and sends
    // it to the review once the claim answers; the desktop app opens links natively.
    const tab = ctx.desktop ? null : window.open("", "_blank")
    const sent = { value: false }
    return openDesignReview({
      sessionID,
      endpoint: {
        url: server.url,
        headers: server.password ? { Authorization: `Basic ${btoa(`opencode:${server.password}`)}` } : undefined,
      },
      explicit: true,
      launch: async (url) => {
        if (ctx.desktop) return ctx.system.openExternal(url)
        if (!tab || tab.closed) throw new Error("The browser blocked the review tab")
        // The review page must not reach back into the app through `window.opener`.
        tab.opener = null
        tab.location.href = url
        sent.value = true
      },
    }).then((notice) => {
      if (tab && !sent.value) tab.close()
      if (!notice || ctx.signal.aborted) return
      const url = notice.url
      showToast({
        title: notice.variant === "error" ? ctx.t("review.failed") : undefined,
        description: notice.message,
        // A click is a fresh gesture, so this tab opens even where the automatic one was blocked.
        actions: url ? [{ label: ctx.t("review.open"), onClick: () => ctx.system.openExternal(url) }] : undefined,
      })
    })
  }
}

export type DesignReviewOpener = ReturnType<typeof createDesignReview>

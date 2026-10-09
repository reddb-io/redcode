import { showToast } from "@opencode/ui/toast"
import { openDesignReview } from "@opencode/util/design-review"
import type { SessionRef, SetupContext } from "../sdk"
import type Design from "./index"
import { openDesignReviewPane } from "./state"

/**
 * Opens a session's Design review. `open` shows it beside the session in the desktop's browser pane, at the review's
 * stable address in its simplified form; the pane signs in with the desktop's own server credential, so no ticket
 * is involved. Where the pane cannot open it (the web app, the pane turned off or not attached yet) and for
 * `external`, the review opens in a system browser: that link carries a short-lived ticket, so it is requested on
 * each open instead of cached, and the launch is claimed on the server like the TUI's, so a review open elsewhere is
 * reported instead of doubled.
 */
export function createDesignReview(ctx: SetupContext<typeof Design>) {
  const external = (session: SessionRef) => {
    // A browser lets a click open a tab only before its first await, so the web app opens an empty tab now and sends
    // it to the review once the claim answers; the desktop app opens links natively.
    const tab = ctx.desktop ? null : window.open("", "_blank")
    const sent = { value: false }
    return openDesignReview({
      sessionID: session.id,
      endpoint: {
        url: session.server.url,
        headers: session.server.password
          ? { Authorization: `Basic ${btoa(`opencode:${session.server.password}`)}` }
          : undefined,
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
  return {
    /** The review beside the session when the browser pane can show it, else in a system browser. */
    open: (session: SessionRef) =>
      openDesignReviewPane(ctx.uses.browser(), session) ? Promise.resolve() : external(session),
    /** The full review in a system browser, also on the desktop. */
    external,
  }
}

export type DesignReviewOpener = ReturnType<typeof createDesignReview>

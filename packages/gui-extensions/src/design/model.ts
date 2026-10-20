import { showToast } from "@opencode/ui/toast"
import { openDesignReview, type Notice } from "@opencode/util/design-review"
import { createKeyed, type SessionRef, type SetupContext } from "../sdk"
import type Design from "./index"
import { openDesignReviewPane } from "./state"

/** Each notice code's copy in the extension's own locales; `Notice.message` is the shared English fallback. */
const noticeKeys = {
  unreachable: "notice.unreachable",
  browserDisabled: "notice.browserDisabled",
  alreadyOpen: "notice.alreadyOpen",
  pending: "notice.pending",
  opened: "notice.opened",
  launchFailed: "notice.launchFailed",
} as const

/**
 * Opens a session's Design review. `open` shows it beside the session in the desktop's browser pane, at the review's
 * stable address in its simplified form; the pane signs in with the desktop's own server credential, so no ticket
 * is involved. While the pane is still loading the request is held and opened there the moment it attaches, with
 * `waiting` answering the click meanwhile. Where the pane cannot open it (the web app, the pane turned off, a narrow
 * window) and for `external`, the review opens in a system browser: that link carries a short-lived ticket, so it is
 * requested on each open instead of cached, and the launch is claimed on the server like the TUI's, so a review open
 * elsewhere is reported instead of doubled.
 */
export function createDesignReview(
  ctx: SetupContext<typeof Design>,
  options?: { readonly waiting?: (session: SessionRef) => void },
) {
  // The browser pane's provider can still be loading when a review is asked for. One run per provider
  // generation: a held request opens in the pane as soon as it attaches.
  let held: SessionRef | undefined
  createKeyed(ctx.uses.browser, () => {
    const session = held
    if (!session) return
    held = undefined
    openDesignReviewPane(ctx.uses.browser(), session)
  })

  const describe = (notice: Notice) => {
    if (!notice.code) return notice.message
    const text = ctx.t(noticeKeys[notice.code], {
      url: notice.url ?? "",
      ...(notice.variable ? { variable: notice.variable } : {}),
    })
    return notice.network ? `${text}\n${ctx.t("notice.network", { network: notice.network })}` : text
  }

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
        description: describe(notice),
        // A click is a fresh gesture, so this tab opens even where the automatic one was blocked.
        actions: url ? [{ label: ctx.t("review.open"), onClick: () => ctx.system.openExternal(url) }] : undefined,
      })
    })
  }
  return {
    /** The review beside the session when the browser pane can show it, else in a system browser. */
    open: (session: SessionRef) => {
      const browser = ctx.uses.browser()
      // A pane that is about to exist is not a reason to exile the review to a system browser the user
      // did not ask for: hold it for the pane and let `waiting` answer the click meanwhile.
      if (browser.status === "pending" && session.server.compatible && !ctx.layout.narrow()) {
        held = session
        options?.waiting?.(session)
        return Promise.resolve()
      }
      return openDesignReviewPane(browser, session) ? Promise.resolve() : external(session)
    },
    /** The full review in a system browser, also on the desktop. */
    external,
  }
}

export type DesignReviewOpener = ReturnType<typeof createDesignReview>

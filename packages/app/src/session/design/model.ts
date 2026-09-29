import { createEffect, createMemo, on } from "solid-js"
import { openDesignReview } from "@opencode/util/design-review"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { authTokenFromCredentials } from "@/runtime/server/api"
import { useServerSDK } from "@/runtime/server/client"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { SESSION_DESIGN_TAB } from "@/session/helpers"
import type { SessionModel } from "../model"
import { designActivity, latestDesignPreview } from "./state"

export function createSessionDesign(session: SessionModel) {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServerSDK()

  const open = () => {
    session.layout.view().reviewPanel.open()
    const tabs = session.layout.tabs()
    if (tabs.active() !== SESSION_DESIGN_TAB) tabs.open(SESSION_DESIGN_TAB)
  }

  // A preview published while the agent works brings the tab forward once, the way a browser opens a
  // tab; loading an older session's history never does, and closing the tab keeps it closed.
  createEffect(
    on(
      () => ({ sessionID: session.identity.sessionID(), preview: latestDesignPreview(session.history.messages()) }),
      (next, previous) => {
        if (!next.preview || !previous || next.sessionID !== previous.sessionID) return
        if (next.preview === previous.preview || !session.data.working()) return
        open()
      },
    ),
  )

  // The review link carries a short-lived ticket, so it is requested on each open instead of cached. The
  // launch is claimed on the server like the TUI's, so a review open elsewhere is reported instead of doubled.
  const openReview = (sessionID: string) => {
    // A browser lets a click open a tab only before its first await, so the web app opens an empty tab now and
    // sends it to the review once the claim answers; the desktop app opens links natively.
    const tab = platform.platform === "web" ? window.open("", "_blank") : null
    const sent = { value: false }
    const password = server.server.http.password
    return openDesignReview({
      sessionID,
      endpoint: {
        url: server.url,
        headers: password ? { Authorization: `Basic ${authTokenFromCredentials({ password })}` } : undefined,
      },
      explicit: true,
      fetch: platform.fetch,
      launch: async (url) => {
        if (platform.platform !== "web") return platform.openExternal(url)
        if (!tab || tab.closed) throw new Error("The browser blocked the review tab")
        // The review page must not reach back into the app through `window.opener`.
        tab.opener = null
        tab.location.href = url
        sent.value = true
      },
    }).then((notice) => {
      if (tab && !sent.value) tab.close()
      if (!notice) return
      const url = notice.url
      showToast({
        title: notice.variant === "error" ? language.t("session.design.review.failed") : undefined,
        description: notice.message,
        // A click is a fresh gesture, so this tab opens even where the automatic one was blocked.
        actions: url
          ? [{ label: language.t("session.design.review.open"), onClick: () => platform.openExternal(url) }]
          : undefined,
      })
    })
  }

  command.register("session.design", () => [
    {
      id: "session.design",
      title: language.t("command.session.design"),
      description: language.t("command.session.design.description"),
      category: language.t("command.category.session"),
      slash: "design-review",
      disabled: !session.isDesktop() || !session.identity.sessionID(),
      onSelect: open,
    },
  ])

  return {
    sessionID: session.identity.sessionID,
    /** Changes whenever the session's designs may have changed, so the tab reads them again. */
    activity: createMemo(() => designActivity(session.history.messages())),
    openReview,
  }
}

export type SessionDesignModel = ReturnType<typeof createSessionDesign>

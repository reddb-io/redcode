import { createEffect, createMemo, on } from "solid-js"
import { Schema } from "effect"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { authTokenFromCredentials } from "@/runtime/server/api"
import { useServerSDK } from "@/runtime/server/client"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { SESSION_DESIGN_TAB } from "@/session/helpers"
import type { SessionModel } from "../model"
import { designActivity, latestDesignPreview } from "./state"

const ReviewLink = Schema.Struct({ url: Schema.String })
const ReviewError = Schema.Struct({ message: Schema.String })

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

  // The review link carries a short-lived ticket, so it is requested on each open instead of cached.
  const openReview = (sessionID: string) => {
    const password = server.server.http.password
    return (platform.fetch ?? fetch)(new URL(`/design/session/${encodeURIComponent(sessionID)}/link`, server.url), {
      headers: password ? { Authorization: `Basic ${authTokenFromCredentials({ password })}` } : undefined,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => undefined)
        if (!response.ok) throw new Error(Schema.is(ReviewError)(body) ? body.message : `HTTP ${response.status}`)
        return Schema.decodeUnknownSync(ReviewLink)(body)
      })
      .then((link) => platform.openExternal(link.url))
      .catch((error) =>
        showToast({
          title: language.t("session.design.review.failed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
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

import { Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import type { Part } from "@reddb-io/redcode-sdk/v2/client"
import { latestDesignPreview } from "./session-design-preview"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

/**
 * The prototype the agent last opened, embedded.
 *
 * Nothing here is a second implementation of the review surface: the panel loads the same shell
 * the browser tab does, with `?embed=1` so the shell drops its own header. Annotations, the
 * feedback route and the revision poll all stay in that one document, which is also the only
 * one holding the prototype's token.
 */
export function SessionDesignTab() {
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const preview = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return undefined
    return latestDesignPreview(sync().data.message[sessionID] ?? [], (id) => (sync().data.part[id] ?? []) as Part[])
  })

  const src = createMemo(() => {
    const current = preview()
    if (!current) return undefined
    const base = sdk().url.replace(/\/$/, "")
    // The revision rides in the URL so a rewrite remounts the frame instead of trusting the poll.
    return `${base}/design/${current.id}?embed=1&rev=${current.revision}`
  })

  return (
    <Show
      when={src()}
      fallback={
        <div class="h-full flex items-center justify-center text-14-regular text-text-weak px-6 text-center">
          {language.t("session.design.empty")}
        </div>
      }
    >
      {(url) => (
        <iframe
          data-component="session-design-frame"
          src={url()}
          title={preview()?.name}
          class="w-full h-full border-0 bg-background-base"
          // The shell is ours, but the prototype inside it is not: the shell sandboxes it again.
          allow=""
        />
      )}
    </Show>
  )
}

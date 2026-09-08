import { createEffect, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { authTokenFromCredentials } from "@/utils/server"

export function SessionDesignTab() {
  const params = useParams()
  const sdk = useSDK()
  const server = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const root = document.createElement("div")
  root.className = "h-full w-full"
  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    const base = sdk().url
    const connection = server().server.http
    const host = document.createElement("div")
    host.style.height = "100%"
    root.replaceChildren(host)
    const state = { disposed: false, cleanup: undefined as (() => void) | undefined }
    void Promise.all([import("@reddb-io/redcode-design/review"), import("@reddb-io/redcode-design/copy")]).then(
      ([review, copy]) => {
        if (state.disposed) return
        state.cleanup = review.mountReview(host, {
          base,
          sessionID,
          copy: Object.fromEntries(
            Object.keys(copy.reviewCopy).map((key) => [
              key,
              language.t(`session.design.studio.${key as keyof typeof copy.reviewCopy}`),
            ]),
          ) as typeof copy.reviewCopy,
          request: (url, init) => {
            const headers = new Headers(init?.headers)
            if (connection.password)
              headers.set(
                "Authorization",
                `Basic ${authTokenFromCredentials({ username: connection.username, password: connection.password })}`,
              )
            return (platform.fetch ?? fetch)(url, { ...init, headers })
          },
        })
      },
    )
    onCleanup(() => {
      state.disposed = true
      state.cleanup?.()
    })
  })
  return root
}

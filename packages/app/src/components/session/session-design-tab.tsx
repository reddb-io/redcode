import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { authTokenFromCredentials } from "@/utils/server"
import { createSessionDesignMount } from "./session-design-mount"

export function SessionDesignTab() {
  const params = useParams()
  const sdk = useSDK()
  const server = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const root = document.createElement("div")
  root.className = "h-full w-full"
  createSessionDesignMount({
    root,
    load: () => import("@reddb-io/redcode-design/review"),
    translate: language.t,
    options: () => {
      const sessionID = params.id
      if (!sessionID) return
      const base = sdk().url
      const connection = server().server.http
      return {
        base,
        sessionID,
        request: (url, init) => {
          const headers = new Headers(init?.headers)
          if (connection.password)
            headers.set(
              "Authorization",
              `Basic ${authTokenFromCredentials({ username: connection.username, password: connection.password })}`,
            )
          return (platform.fetch ?? fetch)(url, { ...init, headers })
        },
      }
    },
  })
  return root
}

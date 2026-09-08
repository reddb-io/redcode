import { Redcode } from "@reddb-io/redcode-client"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { authTokenFromCredentials } from "./server"

export function useGoalApi() {
  const sdk = useSDK()
  const server = useServerSDK()
  const platform = usePlatform()
  const client = () => {
    const connection = server().server.http
    return Redcode.make({
      baseUrl: sdk().url,
      fetch: platform.fetch ?? fetch,
      headers: connection.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({ username: connection.username, password: connection.password })}`,
          }
        : undefined,
    }).sessions
  }
  const notify = (sessionID: string) => window.dispatchEvent(new CustomEvent("redcode:goal", { detail: sessionID }))
  return {
    current: () => sdk().protocol.then((protocol) => protocol === "v2"),
    get: (sessionID: string) => client().goal({ sessionID }),
    plans: (sessionID: string) => client().plans({ sessionID }),
    set: async (input: Parameters<ReturnType<typeof client>["goalSet"]>[0]) => {
      const goal = await client().goalSet(input)
      notify(input.sessionID)
      return goal
    },
    control: async (input: Parameters<ReturnType<typeof client>["goalControl"]>[0]) => {
      const goal = await client().goalControl(input)
      notify(input.sessionID)
      return goal
    },
  }
}

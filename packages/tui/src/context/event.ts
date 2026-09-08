import type { Event } from "@reddb-io/redcode-sdk/v2"
import { useSDK } from "./sdk"
import { onCleanup } from "solid-js"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

export function useEvent() {
  const sdk = useSDK()
  const subscriptions = new Set<() => void>()
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions.clear()
  })

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    if (disposed) return () => {}
    const unsubscribe = sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      handler(event.payload, { directory: event.directory, workspace: event.workspace })
    })
    subscriptions.add(unsubscribe)
    return () => {
      subscriptions.delete(unsubscribe)
      unsubscribe()
    }
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}

import type { EventApi } from "@opencode/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {
  readonly subscribeFiltered?: (input: {
    readonly types: readonly string[]
  }) => ReturnType<EventApi<unknown>["subscribe"]>
}

export const subscribeFiltered = (event: EventDomain, input: { readonly types: readonly string[] }) =>
  event.subscribeFiltered?.(input) ?? event.subscribe()

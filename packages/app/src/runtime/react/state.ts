import type { SharedSource } from "@/runtime/react/source"

/** One state store shared by renderer adapters and native React consumers. */
export function sharedState<State extends object>(initial: State) {
  const state = { value: initial }
  const listeners = new Set<() => void>()
  const source: SharedSource<State> = {
    getSnapshot: () => state.value,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    ...source,
    update(patch: Partial<State>) {
      if (Object.entries(patch).every(([key, value]) => Object.is(state.value[key as keyof State], value))) return
      state.value = { ...state.value, ...patch }
      listeners.forEach((listener) => listener())
    },
  }
}

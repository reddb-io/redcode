import { createEffect, createRoot, getOwner, runWithOwner, createSignal, onCleanup } from "solid-js"

export type SharedSource<Value> = {
  getSnapshot: () => Value
  subscribe: (listener: () => void) => () => void
}

/** Observe an existing application service without moving its ownership into a React render. */
export function sharedSource<Value>(read: () => Value): SharedSource<Value> {
  const owner = getOwner()
  const listeners = new Set<() => void>()
  const state = { value: read(), dispose: undefined as (() => void) | undefined, closed: false }
  if (owner)
    onCleanup(() => {
      state.closed = true
      state.dispose?.()
      state.dispose = undefined
      listeners.clear()
    })

  return {
    getSnapshot: () => state.value,
    subscribe(listener) {
      if (state.closed) return () => {}
      listeners.add(listener)
      if (!state.dispose) {
        state.dispose = runWithOwner(owner, () =>
          createRoot((dispose) => {
            // Read after Solid has applied conditional scope changes and disposed their owners.
            createEffect(() => {
              state.value = read()
              listeners.forEach((notify) => notify())
            })
            return dispose
          }),
        )
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        state.dispose?.()
        state.dispose = undefined
      }
    },
  }
}

/** Read the same external snapshot in an existing application-service scope. */
export function observeShared<Value>(source: SharedSource<Value>) {
  const [value, setValue] = createSignal(source.getSnapshot())
  onCleanup(source.subscribe(() => setValue(() => source.getSnapshot())))
  return value
}

import { getOwner, onCleanup, runWithOwner, type JSX } from "solid-js"
import { render } from "solid-js/web"

export type SharedMount = (element: HTMLElement) => () => void

/** Retain service ownership even when the enclosing React root unmounts after its parent commit. */
export function sharedMount(view: () => JSX.Element): SharedMount {
  const owner = getOwner()
  const mounts = new Set<() => void>()
  const state = { closed: false }
  if (owner)
    onCleanup(() => {
      state.closed = true
      mounts.forEach((dispose) => dispose())
    })
  return (element) => {
    if (state.closed) return () => {}
    const dispose = runWithOwner(owner, () => render(() => <>{view()}</>, element)) ?? (() => {})
    const release = () => {
      if (mounts.delete(release)) dispose()
    }
    mounts.add(release)
    if (state.closed) release()
    return release
  }
}

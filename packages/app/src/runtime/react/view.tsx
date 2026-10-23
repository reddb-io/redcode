import { createElement, type ComponentType } from "react"
import { createRoot } from "react-dom/client"
import { createRenderEffect, createSignal, onCleanup, onMount } from "solid-js"

/** Temporary mount boundary while complete GUI surfaces move from Solid to React. */
export function ReactView<Props extends object>(props: { component: ComponentType<Props>; props: Props }) {
  let element!: HTMLDivElement

  onMount(() => {
    const state = { root: undefined as ReturnType<typeof createRoot> | undefined }
    const [connected, setConnected] = createSignal(element.isConnected)
    // Solid portals can mount their children before adopting the host into the document.
    // Native DS dialogs require that adoption before their opening effect calls showModal().
    const observer = element.isConnected
      ? undefined
      : new MutationObserver(() => {
          if (!element.isConnected) return
          observer?.disconnect()
          setConnected(true)
        })
    // Template content has an inert ownerDocument until adoption; observe the browsing document.
    observer?.observe(document, { childList: true, subtree: true })
    // React owns this subtree; Solid only forwards snapshots of the existing controllers.
    createRenderEffect(() => {
      if (!connected()) return
      const root = (state.root ??= createRoot(element))
      root.render(createElement(props.component, props.props))
    })
    // A shared service slot can dispose this child during its parent React commit.
    onCleanup(() => {
      observer?.disconnect()
      queueMicrotask(() => state.root?.unmount())
    })
  })

  return <div ref={element} class="contents" />
}

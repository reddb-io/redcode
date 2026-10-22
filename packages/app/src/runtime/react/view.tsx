import { createElement, type ComponentType } from "react"
import { createRoot } from "react-dom/client"
import { createRenderEffect, onCleanup, onMount } from "solid-js"

/** Temporary mount boundary while complete GUI surfaces move from Solid to React. */
export function ReactView<Props extends object>(props: { component: ComponentType<Props>; props: Props }) {
  let element!: HTMLDivElement

  onMount(() => {
    const root = createRoot(element)
    // React owns this subtree; Solid only forwards snapshots of the existing controllers.
    createRenderEffect(() => root.render(createElement(props.component, props.props)))
    // A shared service slot can dispose this child during its parent React commit.
    onCleanup(() => queueMicrotask(() => root.unmount()))
  })

  return <div ref={element} class="contents" />
}

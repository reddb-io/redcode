/** @jsxImportSource react */
import { useLayoutEffect, useRef } from "react"
import type { SharedMount } from "./mount"

/** A temporary boundary for services and contributions whose renderer migrates with the application shell. */
export function SharedSlot(props: { mount: SharedMount; className?: string }) {
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (element.current) return props.mount(element.current)
  }, [props.mount])
  return <div ref={element} className={props.className ?? "contents"} />
}

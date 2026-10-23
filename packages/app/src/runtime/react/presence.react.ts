import { useLayoutEffect, useRef, useState } from "react"

/** Inspect exit animations after React commits the hidden state to the actual element. */
export function usePresence<Value>(value: Value | undefined, identity?: unknown) {
  const element = useRef<HTMLDivElement>(null)
  const previous = useRef(identity)
  const [displayed, setDisplayed] = useState<Value | undefined>(value)
  useLayoutEffect(() => {
    const changed = previous.current !== identity
    previous.current = identity
    if (value !== undefined) {
      setDisplayed(() => value)
      return
    }
    if (changed || !element.current) {
      setDisplayed(undefined)
      return
    }
    const lifetime = new AbortController()
    void Promise.allSettled(element.current.getAnimations().map((animation) => animation.finished)).then(() => {
      if (!lifetime.signal.aborted) setDisplayed(undefined)
    })
    return () => lifetime.abort()
  }, [value, identity])
  return { element, value: displayed, present: displayed !== undefined }
}

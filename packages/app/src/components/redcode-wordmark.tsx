import type { JSX } from "solid-js"

export function RedcodeWordmark(props: {
  class?: string
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
}) {
  const content = () => (
    <span data-slot="redcode-wordmark-text" aria-hidden="true">
      <span data-slot="redcode-wordmark-accent">red</span>
      <span>code</span>
    </span>
  )

  if (!props.onClick) {
    return (
      <span data-slot="redcode-wordmark" class={props.class} aria-label="redcode">
        {content()}
      </span>
    )
  }

  return (
    <button type="button" data-slot="redcode-wordmark" class={props.class} onClick={props.onClick} aria-label="redcode">
      {content()}
    </button>
  )
}

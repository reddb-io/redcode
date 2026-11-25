import { loadingIndicator } from "@reddb-io/design-system/contracts/loading-indicator"
import { splitProps, type ComponentProps } from "solid-js"

const slots = loadingIndicator({ labelHidden: true })

export function Loader(props: ComponentProps<"svg">) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height"])

  return (
    <svg
      data-component="loader-v2"
      {...rest}
      class={local.class}
      classList={{ "shrink-0": true, ...local.classList }}
      width={local.width ?? 16}
      height={local.height ?? 16}
      viewBox="0 0 24 24"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <g class={slots.spinner({ class: "origin-center" })}>
        <circle data-slot="loader-v2-background" class={slots.track()} cx="12" cy="12" r="9" stroke-width="3" />
        <path
          data-slot="loader-v2-progress"
          class={slots.head()}
          d="M21 12a9 9 0 0 0-9-9"
          stroke-width="3"
          stroke-linecap="round"
        />
      </g>
    </svg>
  )
}

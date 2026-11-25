import { divider } from "@reddb-io/design-system/contracts/divider"
import { type ComponentProps, splitProps } from "solid-js"

export function Divider(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <div
      {...rest}
      role="separator"
      aria-orientation="horizontal"
      data-component="divider-v2"
      class={divider({ orientation: "horizontal", class: local.class })}
      classList={local.classList}
    />
  )
}

export type DividerProps = ComponentProps<"div">

import type { ComponentProps } from "solid-js"
import { Loader } from "../feedback/loader/loader"

export function Spinner(props: ComponentProps<"svg">) {
  return <Loader width={18} height={18} {...props} data-component="spinner" />
}

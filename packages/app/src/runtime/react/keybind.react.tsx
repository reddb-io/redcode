/** @jsxImportSource react */
import { Kbd } from "@reddb-io/design-system/base/Kbd"

export function Keybind(props: { keys: string[] }) {
  return <Kbd data-component="keybind-v2" keys={props.keys} size="sm" separator="" />
}

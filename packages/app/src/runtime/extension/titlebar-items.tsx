import { createMemo } from "solid-js"
import { TitlebarItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"

/** TitlebarItem contributions placed in the titlebar (the default placement). */
export function useTitlebarItems() {
  const host = useExtensionHost()

  const items = createMemo(() =>
    host.list(TitlebarItem).filter((item) => (item.placement ?? "titlebar") === "titlebar"),
  )

  // Keyed by id so a pill keeps its element (and hover state) while its item changes.
  const ids = createMemo(() => items().map((item) => item.id), undefined, {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  })

  return {
    ids,
    item: (id: string) => items().find((item) => item.id === id),
  }
}

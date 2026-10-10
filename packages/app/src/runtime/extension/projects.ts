import { createMemo } from "solid-js"
import { MenuItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"

/** MenuItem "project" contributions, in order. */
export function useProjectMenuItems() {
  const host = useExtensionHost()

  return createMemo(() =>
    host
      .list(MenuItem)
      .flatMap((item) => (item.menu === "project" ? [item] : []))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )
}

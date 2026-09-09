import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

export type PermissionMode = "auto" | "normal" | "yolo"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: args.yolo ? "yolo" : args.auto ? "auto" : "normal",
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: Exclude<PermissionMode, "yolo">) {
        if (args.yolo) return
        setStore("mode", mode)
      },
      toggle() {
        if (args.yolo) return
        setStore("mode", (mode) => (mode === "auto" ? "normal" : "auto"))
      },
    }
  },
})

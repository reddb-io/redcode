import { createMemo } from "solid-js"
import type { UpdaterState } from "@/updater"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"

export function updaterAction(state: UpdaterState | undefined) {
  if (!state) return { label: "Check now" as const }
  switch (state.status) {
    case "checking":
      return { label: "Checking..." as const }
    case "downloading":
      return { label: "Downloading..." as const }
    case "ready":
      return { label: "Install and restart" as const, run: "install" as const }
    case "installing":
      return { label: "Installing..." as const }
    case "disabled":
      return { label: "Check now" as const }
    default:
      return { label: "Check now" as const, run: "check" as const }
  }
}

export function useUpdaterAction() {
  const platform = usePlatform()
  const action = createMemo(() => updaterAction(platform.updater?.state()))

  return {
    action,
    async run() {
      const run = action().run
      if (run === "install") return platform.updater?.install()
      if (run !== "check") return

      const state = await platform.updater?.check()
      if (state?.status === "up-to-date") {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: "You're up to date",
          description: "You're running the latest version of Redcode.",
        })
      }
      if (state?.status === "error") {
        showToast({ title: "Request failed", description: state.message })
      }
    },
  }
}

import { showToast } from "@opencode/ui/toast"
import { onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { flushPersisted } from "@/runtime/persistence/persist"
import { startWebUpdate } from "./web-update"

export function WebUpdateNotice() {
  const language = useLanguage()
  onMount(() => {
    if (!import.meta.env.PROD) return
    const stop = startWebUpdate({
      beforeReload: flushPersisted,
      ready: (apply) =>
        showToast({
          title: language.t("webUpdate.ready.title"),
          description: language.t("webUpdate.ready.description"),
          persistent: true,
          actions: [{ label: language.t("webUpdate.ready.action"), onClick: apply }],
        }),
    })
    onCleanup(stop)
  })
  return null
}

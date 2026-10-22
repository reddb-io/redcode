import { useLanguage } from "@/runtime/i18n/language"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { ChatGPTNotice } from "./chatgpt-notice.react"
import { usePlatform } from "@/runtime/platform/platform"

export function DialogChatGPTUsageLimit() {
  const language = useLanguage()
  const modal = useNativeDialog()
  const platform = usePlatform()
  const source = sharedSource(() => ({ language: sharedLanguage(language), open: modal.open() }))
  return (
    <ReactView
      component={ChatGPTNotice}
      props={{
        source,
        kind: "usage",
        close: modal.close,
        manage: () => {
          platform.openExternal("https://chatgpt.com/settings/usage")
          modal.close()
        },
      }}
    />
  )
}

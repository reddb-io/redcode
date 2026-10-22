import { useLanguage } from "@/runtime/i18n/language"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { ChatGPTNotice } from "./chatgpt-notice.react"

export function DialogChatGPTPlanWelcome() {
  const language = useLanguage()
  const modal = useNativeDialog()
  const source = sharedSource(() => ({ language: sharedLanguage(language), open: modal.open() }))
  return <ReactView component={ChatGPTNotice} props={{ source, kind: "welcome", close: modal.close }} />
}

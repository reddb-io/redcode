import { useLanguage } from "@/runtime/i18n/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { Dropzone } from "./dropzone.react"

export function createDropzoneServices(props: {
  active: boolean
  input?: { image?: boolean; pdf?: boolean }
  identity?: () => string | undefined
}) {
  const language = useLanguage()
  const label = () => {
    if (!props.input?.image && !props.input?.pdf) return language.t("ui.promptInput.dropFiles")

    if (!props.input.pdf) return language.t("ui.promptInput.dropFiles.image")

    if (!props.input.image) return language.t("ui.promptInput.dropFiles.pdf")

    return language.t("ui.promptInput.dropFiles.imagePdf")
  }

  return {
    snapshot: sharedSource(() => ({ active: props.active, label: label(), identity: props.identity?.() })),
  }
}

export function ComposerDropzone(props: Parameters<typeof createDropzoneServices>[0]) {
  const services = createDropzoneServices(props)
  return <ReactView component={Dropzone} props={{ services }} />
}

import { useNativeDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { ReactView } from "./react-view"
import { ImagePreviewDialog } from "./image-preview.react"

export interface ImagePreviewProps {
  src: string
  alt?: string
}

export function ImagePreview(props: ImagePreviewProps) {
  const i18n = useI18n()
  const modal = useNativeDialog()
  return (
    <ReactView
      component={ImagePreviewDialog}
      props={{
        src: props.src,
        title: props.alt || i18n.t("ui.imagePreview.alt"),
        closeLabel: i18n.t("ui.common.close"),
        open: modal.open(),
        close: modal.close,
      }}
    />
  )
}

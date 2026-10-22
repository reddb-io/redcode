import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedMount } from "@/runtime/react/mount"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import type { JSX } from "solid-js"
import { UsageExceededDialog } from "./usage-exceeded.react"

export type DialogGoUpsellProps = {
  title: string
  description: JSX.Element
  link?: string
  actionLabel: string
  onClose?: (dontShowAgain?: boolean) => void
}

export function DialogUsageExceeded(props: DialogGoUpsellProps) {
  const modal = useNativeDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    title: props.title,
    actionLabel: props.actionLabel,
  }))
  const description = sharedMount(() => props.description)
  const action = () => {
    if (props.link) platform.openExternal(props.link)
    props.onClose?.()
    modal.close()
  }
  const dismiss = () => {
    props.onClose?.(true)
    modal.close()
  }
  return (
    <ReactView component={UsageExceededDialog} props={{ source, description, action, dismiss, close: modal.close }} />
  )
}

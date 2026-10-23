import { createMemo } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import type { WebSearchRequestModel } from "./websearch"
import { SessionWebSearchDockView } from "./session-websearch-dock.react"
import "./session-websearch-dock.css"

export function createSessionWebSearchServices(props: { model: WebSearchRequestModel; onSubmit: () => void }) {
  const language = useLanguage()
  const options = createMemo(() => [
    ...(props.model.specific() ? [] : [{ value: "random", label: language.t("session.websearch.any") }]),
    ...props.model.options(),
  ])
  const busy = () => props.model.sending() || !props.model.connected()
  const status = () => {
    if (props.model.loading()) return language.t("common.loading")
    if (props.model.failed()) return language.t("session.websearch.failed")
    if (!props.model.options().length) return language.t("session.websearch.empty")
  }
  const submit = (selection: string | false) => {
    if (busy()) return
    props.onSubmit()
    void props.model.submit(selection)
  }
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      options: options(),
      selected: props.model.selected(),
      current: options().some((option) => option.value === props.model.selected()),
      sending: props.model.sending(),
      busy: busy(),
      unavailable: props.model.loading() || props.model.loadFailed() || !props.model.options().length,
      specific: props.model.specific(),
      loadFailed: props.model.loadFailed(),
      status: status(),
    })),
    select: (value: string) => props.model.select(value),
    retry: () => props.model.retry(),
    decline: () => submit(false),
    enable: () => {
      const selected = props.model.selected()
      if (selected) submit(selected)
    },
  }
}

export function SessionWebSearchDock(props: Parameters<typeof createSessionWebSearchServices>[0]) {
  const services = createSessionWebSearchServices(props)
  return <ReactView component={SessionWebSearchDockView} props={{ services }} />
}

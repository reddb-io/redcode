/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedMount } from "@/runtime/react/mount"
import type { HomeScrollController } from "./scroll"

export function HomeView(props: {
  source: SharedSource<SharedLanguage>
  projects: SharedMount
  sessions: SharedMount
  scroll: HomeScrollController
  bindViewport: (element: HTMLDivElement | null) => void
}) {
  const language = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return (
    <div
      data-component="home"
      data-slot="home-panel"
      className="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 self-stretch overflow-hidden rounded-lg bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h1 className="sr-only">{language.t("home.title")}</h1>
        <div className="relative z-40 mx-auto flex w-full max-w-[60rem] shrink-0 px-3 pt-3 md:px-6 md:pt-6 lg:px-10">
          <SharedSlot mount={props.projects} />
        </div>
        <ScrollArea
          ref={props.bindViewport}
          data-scrollable
          label={language.t("ui.scrollView.ariaLabel")}
          variant="plain"
          className="min-h-0 flex-1 overscroll-contain [container-type:size]"
          onScroll={(event) => props.scroll.viewport.update(event.currentTarget.scrollTop)}
        >
          <div className="mx-auto flex min-h-full w-full max-w-[60rem] flex-col px-3 md:px-6 lg:px-10">
            <SharedSlot mount={props.sessions} />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

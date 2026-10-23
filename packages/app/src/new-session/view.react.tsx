/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Logo } from "@reddb-io/design-system/base/Logo"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { Dropzone } from "@/composer/dropzone.react"
import { Icon } from "@/runtime/react/icon.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import { usePresence } from "@/runtime/react/presence.react"
import { ProjectAddButton, ProjectSelector } from "./project/selector.react"
import { GitStatus, WorkspaceSelector } from "./workspace/selector.react"
import { NEW_SESSION_CONTENT_WIDTH } from "./layout"
import type { createNewSessionViewServices, createNewSessionTipsServices } from "./view"

export function NewSessionNativeView(props: { services: ReturnType<typeof createNewSessionViewServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  return (
    <div className="@container relative flex min-h-0 h-full flex-1 flex-col">
      <div
        data-component="new-session"
        className="relative flex-1 min-h-0 overflow-hidden rounded-lg bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
      >
        <Dropzone services={services.dropzone} />
        <div className="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
          <div className={NEW_SESSION_CONTENT_WIDTH}>
            <div className="flex justify-center">
              <Logo size={40} />
            </div>
            <div className="mt-8 flex flex-col gap-8">
              <SharedSlot mount={services.composer} />
              {view.empty && <ProjectAddButton services={services.project} />}
              {view.project && (
                <div className="flex min-h-7 min-w-0 flex-row flex-wrap items-center justify-center gap-0 text-ink-muted">
                  <ProjectSelector services={services.project} />
                  {view.workspace ? (
                    <WorkspaceSelector services={services.workspace} />
                  ) : (
                    <GitStatus source={services.git} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <NewSessionTips services={services.tips} />
      </div>
    </div>
  )
}

function NewSessionTips(props: { services: ReturnType<typeof createNewSessionTipsServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const presence = usePresence(view.visible ? view.workspace : undefined)
  if (!presence.present) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
      <div
        ref={presence.element}
        data-component="new-session-tip"
        data-visible={view.visible}
        className="group/new-session-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none data-[visible=false]:animate-out data-[visible=false]:fade-out data-[visible=false]:slide-out-to-bottom-4"
      >
        <Button variant="ghost" size="sm" className="h-6 min-w-0 gap-0 text-ink-muted" onClick={services.open}>
          <span className="truncate">{language.t(presence.value ? "home.workspaceTip" : "home.providerTip")}</span>
          <Icon name="chevron-down" size="small" className="shrink-0 -rotate-90" />
        </Button>
        <Tooltip
          content={language.t("common.dismiss")}
          child={({ props: trigger }) => (
            <Button
              {...trigger}
              variant="ghost"
              size="sm"
              className="hover-reveal absolute left-full top-0 h-6 w-7 delay-0 duration-0 group-hover/new-session-tip:delay-[250ms] group-hover/new-session-tip:duration-150 group-hover/new-session-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
              aria-label={language.t("common.dismiss")}
              onClick={services.dismiss}
            >
              <Icon name="xmark-small" />
            </Button>
          )}
        />
      </div>
    </div>
  )
}

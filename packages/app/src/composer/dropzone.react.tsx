/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Icon } from "@/runtime/react/icon.react"
import { usePresence } from "@/runtime/react/presence.react"
import type { createDropzoneServices } from "./dropzone"

export function Dropzone(props: { services: ReturnType<typeof createDropzoneServices> }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const presence = usePresence(view.active ? view.label : undefined, view.identity)
  return (
    <>
      <div
        data-slot="session-dropzone-blur"
        data-visible={view.active}
        className="pointer-events-none absolute inset-0 z-[79] rounded-[inherit] opacity-[0.001] backdrop-blur-[1.5px] transition-opacity duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] will-change-[opacity,backdrop-filter] data-[visible=true]:opacity-100 motion-reduce:transition-none"
        style={{
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)",
          WebkitMaskComposite: "source-in",
          maskImage:
            "linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)",
          maskComposite: "intersect",
        }}
      />
      {presence.present && (
        <div
          ref={presence.element}
          data-component="session-dropzone"
          data-visible={view.active}
          className="pointer-events-none absolute inset-0 z-[80] grid place-items-center overflow-hidden rounded-[inherit] bg-[color-mix(in_srgb,var(--v2-text-text-base)_var(--session-dropzone-wash),transparent)] opacity-100 transition-opacity duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=false]:opacity-0 motion-reduce:transition-none"
        >
          <div className="absolute inset-0 bg-v2-background-bg-base/25" />
          <div
            className="absolute inset-y-0 left-1/2 w-full -translate-x-1/2 md:max-w-session"
            style={{
              WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
              maskImage: "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
            }}
          >
            <div
              data-slot="session-dropzone-stripes"
              className="absolute inset-0 opacity-60"
              style={{
                background:
                  "repeating-linear-gradient(135deg, transparent 0px, transparent 12px, color-mix(in srgb, var(--v2-text-text-base) var(--session-dropzone-stripe), transparent) 12px, color-mix(in srgb, var(--v2-text-text-base) var(--session-dropzone-stripe), transparent) 24px)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 59% 40% at center, black 0%, rgba(0,0,0,0.72) 58%, transparent 100%)",
                maskImage:
                  "radial-gradient(ellipse 59% 40% at center, black 0%, rgba(0,0,0,0.72) 58%, transparent 100%)",
              }}
            />
          </div>
          <div
            data-slot="session-dropzone-content"
            className="relative flex translate-y-0 flex-col items-center gap-5 opacity-100 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=false]:translate-y-1 data-[visible=false]:opacity-0 motion-reduce:transition-none"
            data-visible={view.active}
          >
            <div
              data-slot="session-dropzone-upload"
              className="flex size-10 items-center justify-center rounded-full bg-[var(--session-dropzone-card)] text-ink-muted shadow-[var(--v2-elevation-floating)]"
              aria-hidden="true"
            >
              <Icon name="arrow-up" size="normal" className="text-ink-muted" />
            </div>
            <div className="text-[15px] font-medium leading-6 text-foreground">{presence.value}</div>
          </div>
        </div>
      )}
    </>
  )
}

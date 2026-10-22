/** @jsxImportSource react */
import { useRef, useSyncExternalStore } from "react"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import { Icon } from "@/runtime/react/icon.react"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import type { ModelSelection } from "./selection"
import { modelTooltipDescription } from "./tooltip-text"

type Model = ReturnType<ModelSelection["list"]>[number]

export function UnpaidModelDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    current: string | undefined
    models: Model[]
    providers: { id: string; name: string }[]
  }>
  selectModel: (model: Model) => void
  openProviders: (provider?: string) => void
  close: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const choices = useRef<HTMLDivElement>(null)
  const title = view.language.t("dialog.model.select.title")
  return (
    <Dialog
      open={view.open}
      title={title}
      showClose={false}
      className="max-h-[calc(100dvh-32px)] [&_[data-dialog-body]]:overflow-y-auto"
      header={() => <DialogHeader title={title} language={view.language} close={props.close} />}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        const buttons = [...(choices.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        if (!buttons.length) return
        const index = buttons.findIndex((button) => button === event.target)
        const next =
          index < 0
            ? event.key === "ArrowDown"
              ? 0
              : buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        buttons[next].focus()
        event.preventDefault()
      }}
    >
      <div ref={choices} className="flex min-h-0 flex-col gap-5">
        <section
          data-section="free-models"
          className="flex flex-col gap-2 [&_[data-tooltip-root]]:flex [&_[data-tooltip-root]]:w-full"
        >
          <h3 className="m-0 text-eyebrow uppercase text-ink-muted">
            {view.language.t("dialog.model.unpaid.freeModels.title")}
          </h3>
          {view.models.map((model) => (
            <Tooltip
              key={`${model.provider.id}:${model.id}`}
              content={modelTooltipDescription(model, view.language, true)}
              child={({ props: trigger }) => (
                <ListRow
                  {...trigger}
                  data-model-tooltip=""
                  className="w-full"
                  onClick={() => props.selectModel(model)}
                  trailing={view.current === `${model.provider.id}:${model.id}` && <Icon name="check" size="small" />}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{model.name}</span>
                    <Badge>{view.language.t("model.tag.free")}</Badge>
                    {model.latest && <Badge>{view.language.t("model.tag.latest")}</Badge>}
                  </span>
                </ListRow>
              )}
            />
          ))}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-eyebrow uppercase text-ink-muted">
            {view.language.t("dialog.model.unpaid.addMore.title")}
          </h3>
          {view.providers.map((provider) => (
            <ListRow
              key={provider.id}
              data-provider-id={provider.id}
              title={provider.name}
              leading={<ProviderModelIcon provider={provider} className="shrink-0" />}
              description={
                provider.id === "opencode" || provider.id === "opencode-go"
                  ? view.language.t(
                      provider.id === "opencode"
                        ? "dialog.provider.opencode.tagline"
                        : "dialog.provider.opencodeGo.tagline",
                    )
                  : undefined
              }
              onClick={() => props.openProviders(provider.id)}
            />
          ))}
          <Button variant="ghost" className="self-start" onClick={() => props.openProviders()}>
            {view.language.t("dialog.model.unpaid.viewMoreProviders")}
          </Button>
        </section>
      </div>
    </Dialog>
  )
}

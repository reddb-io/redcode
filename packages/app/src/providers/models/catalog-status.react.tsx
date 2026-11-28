/** @jsxImportSource react */
import type { ModelsDev } from "@opencode/schema/models-dev"
import type { SharedLanguage } from "@/runtime/react/language"

export function ModelCatalogStatus(props: { catalog: ModelsDev.CatalogStatus; language: SharedLanguage }) {
  const source = props.catalog.origin ?? props.language.t(`dialog.model.catalog.source.${props.catalog.source}`)
  return (
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 break-all text-caption text-ink-muted">
      <span>{props.language.t("dialog.model.catalog.source", { source })}</span>
      <span>
        {props.catalog.updatedAt === undefined
          ? props.language.t("dialog.model.catalog.noUpdate")
          : props.language.t("dialog.model.catalog.lastUpdate", {
              time: new Date(props.catalog.updatedAt).toLocaleString(props.language.intl),
            })}
      </span>
    </div>
  )
}

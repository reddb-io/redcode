/** @jsxImportSource react */
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "./icon.react"
import type { SharedLanguage } from "./language"

export function DialogHeader(props: { title: string; language: SharedLanguage; close: () => void }) {
  return (
    <div className="flex items-center gap-3 pb-[var(--reddb-spatial-gap-lg)]">
      <span className="min-w-0 flex-1 text-heading">{props.title}</span>
      <Button variant="ghost" size="sm" aria-label={props.language.t("common.close")} onClick={props.close}>
        <Icon name="xmark-small" />
      </Button>
    </div>
  )
}

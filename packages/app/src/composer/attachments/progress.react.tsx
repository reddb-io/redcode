/** @jsxImportSource react */
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@reddb-io/design-system/base/Icon"
import { Progress } from "@reddb-io/design-system/base/Progress"

export function UploadProgress(props: {
  items: readonly {
    id: string
    filename: string
    percent: number
    valueText: string
    cancelLabel: string
    cancel: () => void
  }[]
}) {
  return (
    <div className="grid min-w-0 gap-[var(--reddb-spatial-gap-md)]">
      {props.items.map((item) => (
        <div
          key={item.id}
          data-component="upload-row"
          className="flex min-w-0 items-center gap-[var(--reddb-spatial-gap-md)]"
        >
          <Progress
            data-component="upload-progress"
            label={item.filename}
            value={item.percent}
            formatValue={() => item.valueText}
            summary
            className="min-w-0 [overflow-wrap:anywhere] [&_[data-progress-summary]>:last-child]:shrink-0"
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={item.cancelLabel}
            onClick={item.cancel}
            className="shrink-0 aspect-square px-0"
          >
            <Icon icon="x" size="text" aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  )
}

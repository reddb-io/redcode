/** @jsxImportSource react */
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@reddb-io/design-system/base/Icon"
import { image } from "@reddb-io/design-system/contracts/image"

export function ImagePreviewDialog(props: {
  src: string
  title: string
  closeLabel: string
  open: boolean
  close: () => void
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      title={props.title}
      size="xl"
      data-component="image-preview"
      className="w-[min(90vw,75rem)] max-h-[90dvh] gap-[var(--reddb-spatial-gap-md)]"
      header={({ close }) => (
        <div className="flex min-w-0 items-center justify-between gap-[var(--reddb-spatial-gap-md)]">
          <span className="truncate text-heading" title={props.title}>
            {props.title}
          </span>
          <Button variant="ghost" size="sm" aria-label={props.closeLabel} onClick={close}>
            <Icon icon="x" size="text" aria-hidden="true" />
          </Button>
        </div>
      )}
    >
      <img
        src={props.src}
        alt={props.title}
        data-slot="image-preview-image"
        className={image({
          fit: "contain",
          class:
            "mx-auto max-h-[calc(90dvh-var(--reddb-spatial-control-height-md)-2*var(--reddb-spatial-inset-lg)-var(--reddb-spatial-gap-md))]",
        })}
      />
    </Dialog>
  )
}

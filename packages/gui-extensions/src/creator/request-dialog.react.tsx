/** @jsxImportSource react */
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"
import { SearchSelect } from "@reddb-io/design-system/base/SearchSelect"
import { Textarea } from "@reddb-io/design-system/base/Textarea"
import type { SearchSelectOption } from "@reddb-io/design-system/base/recipes"

type CreationFields = {
  kindLabel: string
  kind: string
  options: SearchSelectOption[]
  search: string
  empty: string
  setKind: (value: string) => void
  nameLabel: string
  name: string
  setName: (value: string) => void
  scope: string
  conversation: string
}

export function CreatorRequestDialog(props: {
  open: boolean
  title: string
  description: string
  closeLabel: string
  cancelLabel: string
  submitLabel: string
  creation?: CreationFields
  tools?: string
  requestLabel: string
  request: string
  setRequest: (value: string) => void
  pending: boolean
  disabled: boolean
  busyHint?: string
  error: string
  close: () => void
  submit: () => void
}) {
  const creation = props.creation
  return (
    <Dialog
      open={props.open}
      title={props.title}
      description={props.description}
      className="max-h-[90dvh] w-[min(calc(100vw-24px),32rem)]"
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      header={({ close }) => (
        <div className="flex items-start justify-between gap-2">
          <span className="text-heading">{props.title}</span>
          <Button variant="ghost" size="sm" onClick={close}>
            {props.closeLabel}
          </Button>
        </div>
      )}
      actions={() => (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={props.pending} onClick={props.close}>
            {props.cancelLabel}
          </Button>
          <Button variant="primary" disabled={props.disabled} onClick={props.submit}>
            {props.submitLabel}
          </Button>
        </div>
      )}
    >
      <div className="grid gap-3 pt-3">
        {creation && (
          <>
            <SearchSelect
              label={creation.kindLabel}
              value={creation.kind}
              options={creation.options}
              size="sm"
              clearable={false}
              searchPlaceholder={creation.search}
              emptyText={creation.empty}
              disabled={props.pending}
              onValueChange={creation.setKind}
            />
            <Field label={creation.nameLabel}>
              {(control) => (
                <Input {...control} value={creation.name} disabled={props.pending} onValueChange={creation.setName} />
              )}
            </Field>
          </>
        )}
        {props.tools && <p className="break-words font-mono text-caption text-ink-muted">{props.tools}</p>}
        <Field label={props.requestLabel}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              value={props.request}
              disabled={props.pending}
              onValueChange={props.setRequest}
            />
          )}
        </Field>
        {creation && (
          <>
            <p className="break-words text-caption text-ink-muted">{creation.scope}</p>
            <p className="text-caption text-ink-muted">{creation.conversation}</p>
          </>
        )}
        {props.busyHint && (
          <p role="status" className="text-caption text-ink-muted">
            {props.busyHint}
          </p>
        )}
        {props.error && (
          <p role="alert" className="break-words text-caption text-feedback-danger-foreground">
            {props.error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

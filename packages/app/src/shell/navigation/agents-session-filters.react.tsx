/** @jsxImportSource react */
import { Input } from "@reddb-io/design-system/base/Input"
import { ToggleButton } from "@reddb-io/design-system/base/ToggleButton"

export function AgentSessionFilters(props: {
  query: string
  attention: boolean
  filterLabel: string
  attentionLabel: string
  setQuery: (value: string) => void
  setAttention: (value: boolean) => void
}) {
  return (
    <>
      <Input
        size="sm"
        className="min-h-[var(--reddb-spatial-target-min)] w-full sm:w-48"
        aria-label={props.filterLabel}
        placeholder={props.filterLabel}
        value={props.query}
        onValueChange={props.setQuery}
      />
      <ToggleButton
        className="min-h-[var(--reddb-spatial-target-min)]"
        label={props.attentionLabel}
        pressed={props.attention}
        onPressedChange={props.setAttention}
      />
    </>
  )
}

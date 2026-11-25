/** @jsxImportSource react */
import { DescriptionList } from "@reddb-io/design-system/base/DescriptionList"

export function UsageDetails(props: {
  entries: readonly { term: string; value: string; note?: string; warning?: boolean }[]
}) {
  return (
    <DescriptionList
      gap="sm"
      className="min-w-0 [overflow-wrap:anywhere] [&_dd]:tabular-nums"
      items={props.entries.map((entry) => ({
        term: entry.term,
        detail: (
          <>
            <span
              className={entry.warning ? "whitespace-pre-line text-feedback-warning-foreground" : "whitespace-pre-line"}
            >
              {entry.value}
            </span>
            {entry.note && <p className="text-caption">{entry.note}</p>}
          </>
        ),
      }))}
    />
  )
}

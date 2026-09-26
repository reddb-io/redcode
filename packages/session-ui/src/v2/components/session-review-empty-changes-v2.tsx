import { Icon } from "@reddb-io/redcode-ui/v2/icon"
import "./session-review-v2.css"

export function SessionReviewEmptyChangesV2() {

  return (
    <div data-slot="session-review-v2-empty-changes">
      <Icon name="review" size="large" />
      <div data-slot="session-review-v2-empty-changes-title">{"No file changes yet"}</div>
      <div data-slot="session-review-v2-empty-changes-description">
        {"Project changes will appear here"}
      </div>
    </div>
  )
}

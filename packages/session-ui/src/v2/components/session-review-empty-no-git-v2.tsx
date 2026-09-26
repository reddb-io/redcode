import { FileIcon } from "@reddb-io/redcode-ui/file-icon"
import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import "./session-review-v2.css"

export type SessionReviewEmptyNoGitV2Props = {
  pending: boolean
  onInitGit: () => void
}

export function SessionReviewEmptyNoGitV2(props: SessionReviewEmptyNoGitV2Props) {

  return (
    <div data-slot="session-review-v2-empty-no-git">
      <FileIcon node={{ path: ".gitignore", type: "file" }} mono />
      <div data-slot="session-review-v2-empty-no-git-title">{"No tracked changes"}</div>
      <div data-slot="session-review-v2-empty-no-git-description">
        {"Track, review, and undo changes in this project"}
      </div>
      <ButtonV2 variant="neutral" size="normal" disabled={props.pending} onClick={props.onInitGit}>
        {props.pending
          ? "Creating Git repository..."
          : "Create Git repository"}
      </ButtonV2>
    </div>
  )
}

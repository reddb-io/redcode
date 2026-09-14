---
"@reddb-io/redcode": minor
---

Design review: delete, rename, reorder, merge and split variants from the variant strip. Each operation is sent to the agent as structured feedback and shows in the preview at once (hidden, relabelled or reordered variants; merging and splitting tabs are marked) until the agent's new revision replaces it; a failed request or a turn that ends without the change reverts the view and keeps the request for a retry. Notes on a removed variant can be retargeted, and the terminal and TUI transcript name the requested operation.

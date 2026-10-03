---
"@reddb-io/redcode": patch
---

Keep the Design browser revision picker and live preview synchronized with CLI publications, including retries after a failed revision-list fetch. Preserve drafts and explicit history selections.

Capture the current prototype viewport only on browser approval and attach it as a frozen $screenshot1 reference for Plan. Feedback rounds remain capture-free; approval retries reuse the image, and capture failures do not block the handoff.

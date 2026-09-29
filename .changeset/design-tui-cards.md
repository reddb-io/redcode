---
"@reddb-io/redcode": minor
---

Restore the Design review cards in the TUI on the V2 runtime: browser feedback shows as a compact card (target, revision, variant, operation, numbered notes, attachments) instead of the full `<design-review>` message, an approval shows the approved variant with a link back to the review, and a created design shows its target and design-system chip with the identification line, also when tool details are hidden. Add a storybook story for the cards.

Open the browser review at most once per review again. The server counts connected review pages and grants one launch per 15 seconds, so `/review`, `/design-review` and a newly published revision open no duplicate tab; a publish opens the review only when no page follows the session, a failed launch gives its claim back, and an already open review is reported instead of opened. `REDCODE_NO_BROWSER` still prevents every launch and shows the link. In app mode, review and presenter links to redcode's own server now redirect to the design app, through a waiting page with download progress while the app downloads or starts, and the TUI shows the first download's progress as a toast. `redcode design --target web|app|presentation [--platform ios|android]` skips target detection again, running the session on a private server that receives the forced target.

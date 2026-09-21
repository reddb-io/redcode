---
"@reddb-io/redcode": minor
---

Add continuous System One evaluation for promoted prompts, task quality, final responses, and compaction checkpoints. Persist typed evaluation metrics, retain compressed evidence artifacts for 30 days, allow one tool-free response correction, and expose filtered evaluation history.

Add optional shared RedDB storage through `REDCODE_DATABASE_URL` or global `database.url`, plus database status and explicit verified SQLite-to-RedDB migration commands. SQLite remains the default when no RedDB URL is configured.

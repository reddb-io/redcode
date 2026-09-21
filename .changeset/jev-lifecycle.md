---
"@reddb-io/redcode": minor
---

Add continuous System One evaluation for promoted prompts, task quality, final responses, and compaction checkpoints. Prompt classification now evaluates the original request without an artificial candidate, separates work route, change kind, impact, time pressure, interaction constraints, clarification need, complexity, consequence, and frustration, and derives priority only from confident impact and timing evidence. Persist typed evaluation metrics, retain compressed evidence artifacts for 30 days, allow one tool-free response correction, and expose filtered evaluation history.

Add optional shared RedDB storage through `REDCODE_DATABASE_URL` or global `database.url`, plus database status and explicit verified SQLite-to-RedDB migration commands. SQLite remains the default when no RedDB URL is configured.

Add an English prompt-classification dataset and a live System One evaluation harness that compares providers, repeated-run stability, field accuracy, confidence, latency, and token usage.

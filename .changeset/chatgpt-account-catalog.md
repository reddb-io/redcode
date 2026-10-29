---
"@reddb-io/redcode": patch
---

Discover ChatGPT models from the selected account instead of a fixed model list. Keep a separate cache for each saved connection, refresh it in the background, and preserve known capabilities when the server returns only model names.
Keep cached choices visible while OAuth tokens renew, including temporary refresh failures.

Show model catalog loading, cached results and failures with HTTP status, error code and request ID in Desktop and TUI connection management. Add an explicit model refresh that updates the provider without rebuilding every Location service, and wait for model discovery after ChatGPT sign-in.

Follow all model-list pages in the existing Codex app-server executor, show discovery failures, and identify the running Redcode version instead of an outdated hardcoded version.
Use the Design System's searchable model selector for external executors while retaining explicit custom model IDs.

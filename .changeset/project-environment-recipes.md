---
"@reddb-io/redcode": minor
---

Add reusable project environment recipes to Agents, the TUI and the CLI. Prepare, start, stop, recreate and validate development stacks on the selected execution host. Recipes are shared by project while operations and Docker Compose project names belong to the actual worktree.

Keep project Vault bindings out of saved command output, reject stale recipe revisions, serialize competing host operations and retain request receipts across retries. Interrupted operations require explicit reconciliation and are never replayed automatically. Compose stop/recreate preserves volumes; project-command recipes use explicit lifecycle scripts. These trusted development stacks remain separate from isolated worker sandboxes.

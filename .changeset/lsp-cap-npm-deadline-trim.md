---
"@reddb-io/redcode": patch
---

Cap how many language servers run at once (`REDCODE_LSP_MAX_CLIENTS`, default 8) so a monorepo with per-package linter configs stops spawning one server per package, put a deadline on the npm install that plugin loading holds a cross-process lock across, and trim the whitespace around a typed message so a trailing newline is not part of what you said and a blank input is not sent at all.

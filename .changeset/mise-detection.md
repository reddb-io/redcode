---
"@reddb-io/redcode": patch
---

Only treat an install as mise-managed when Redcode itself came from mise

The check matched any `mise/installs` path in the running executable, so a machine whose Bun comes from mise reported every Redcode install as mise-managed — and self-update would then try `mise upgrade` on a tool mise does not have. It now matches Redcode's own install directory.

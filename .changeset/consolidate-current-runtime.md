---
"@reddb-io/redcode": minor
---

Use the current configuration structure directly and require explicit conversion for older documents. Add migration inspection and conversion commands that preserve source files and refuse to overwrite an existing output. Stop converting terminal preferences during normal reads and updates.

Preserve historical Redcode home directories instead of renaming them at startup. Remove generation labels from CLI help and built-in guidance; `usage path --database` selects the session database path.

Load configuration and LSP status from the current location APIs. Archive settled session trees through one durable API shared by clients, reject new work until restoration, and keep archived descendants visible to internal accounting and recovery.

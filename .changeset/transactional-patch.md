---
"@reddb-io/redcode": patch
---

Make `apply_patch` transactional. Every hunk is now staged in memory against the current file contents, so later hunks see earlier ones, including updates to a file moved earlier in the same patch. Permission checks cover move destinations, and nothing touches disk until every path is verified and approved. Each file is written atomically (temp file and rename, keeping its mode and symlinks). A patch fails without writing if a file changed while approval was pending. A failure midway rolls back the files already written, and the error lists what was rolled back and anything that could not be. CRLF line endings and a missing trailing newline are preserved.

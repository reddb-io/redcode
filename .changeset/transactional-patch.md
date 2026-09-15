---
"@reddb-io/redcode": patch
---

Make `apply_patch` transactional:

- **Staging:** every hunk is staged in memory against the current file contents, so later hunks see earlier ones, including updates to a file moved earlier in the same patch.
- **Checks:** permission, repository and external-directory checks run on every path with symlinks resolved, including move sources and destinations, deletes, and new files under a linked directory. Nothing touches disk until every path is verified and approved.
- **Writes:** each file is written atomically through an exclusive temp file created with the target's mode, keeping its mode and symlinks.
- **Failures:** a patch fails without writing if a file changed while approval was pending, or if two paths resolve to the same file. A failure midway rolls back the files already written, restoring deleted symlinks as symlinks, and the error lists what was rolled back and anything that could not be.
- **Permission diff:** it shows when an added or moved file replaces an existing one.
- **Line endings:** each line keeps its own ending, new lines use the file's dominant ending, and a missing trailing newline is preserved.

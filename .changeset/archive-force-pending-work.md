---
"@reddb-io/redcode": patch
---

Session and project management from the session list and project menus.

- Allow archiving a session family that still has pending work. `POST /api/session/:id/archive` accepts an optional `force` flag, `redcode session archive --force` forces from the CLI, and the TUI session list archives anyway when `ctrl+e` is pressed again after a busy rejection, with a clearer error message.
- Add `DELETE /api/project/:projectID` to archive a project so it leaves the project list; resolving its directory restores it. `redcode project remove` exposes it from the CLI and the desktop project menu gains a "Remove project" action.
- The desktop session menu gains archive, delete, and a local hide/unhide that filters the session out of this client's lists without touching the server; the desktop project menu gains a "Remove project" action, and a server-initiated agent switch (approved plan moving to Build) now clears the composer's stale local agent override so the mode follows the session.

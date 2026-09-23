---
"@reddb-io/redcode": minor
---

Writing sessions now get their own worktree automatically. In a Git repository, the first edit, write or build command a session makes in the primary checkout creates `.red/worktrees/<name>` on a new branch `<name>` (named after the session, with `-2`, `-3` on collisions), moves the session and its subagents there and runs the action in it. The primary checkout is never stashed, reset or cleaned, and `.red/worktrees/` is added to `.git/info/exclude`. Reading never creates a worktree; non-Git directories and YOLO mode are unchanged. The session sidebar footer now shows the project, the worktree and the branch on three short lines.

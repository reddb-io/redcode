---
"@reddb-io/redcode": patch
---

Allow signed Design review links to reach their session-scoped ticket authentication instead of prompting the browser for the service password. Invalid or expired tickets remain rejected, and review cookies do not grant service API or Design permission access.

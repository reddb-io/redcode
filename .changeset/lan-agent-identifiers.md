---
"@reddb-io/redcode": patch
---

Fix agent harnesses, remote worker tasks, environment cloning, SSH dialogs and side questions over LAN HTTP when the browser does not expose crypto.randomUUID. Reuse the shared identifier generator with a random-byte UUID fallback for those browsers.

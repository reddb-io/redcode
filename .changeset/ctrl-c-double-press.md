---
"@reddb-io/redcode": patch
---

Ctrl+C and Ctrl+D no longer quit on the first press. On an idle, empty prompt the first press shows "Press ctrl+c again to exit" and a second press within two seconds exits; while the agent works, Ctrl+C interrupts the turn instead of quitting.

---
"@reddb-io/redcode": patch
---

Self-update on a mise install now lands, instead of reporting success and leaving the old version

Two things went wrong for an install managed by mise. `mise upgrade` only moves within the version range the config already allows, and red-dev pins an exact version, so mise found the new release, decided it did not match the range, and exited 0 having done nothing. The upgrade now runs `mise upgrade --bump`, which is mise's own idiom for moving the pin as well.

The check afterwards asked whether the target was installed. mise keeps every version it ever fetched and the shim runs the one that is active, so a version could be on disk while the old one kept running: the update reported success and restarting opened the old version again. It now requires the target to be the active one, and when it is installed but not selected it says so and gives the command that fixes it.

---
"@reddb-io/redcode": patch
---

Say when mise is holding a release back, instead of reporting a failed install

mise refuses to install a release younger than its `minimum_release_age`, and says so only on a line of stderr nobody reads. The update prompt offered a version mise had quietly decided not to see, `mise upgrade` exited 0 having done nothing, and the failure read as "mise did not install vX" — sending the user to run a command that changes nothing. When the version is not even on offer, the message now names the gate and gives the one-line fix that lets Redcode's own releases through while keeping the delay for everything else. The five turn bounds and `redcode debug guards` are now documented too.

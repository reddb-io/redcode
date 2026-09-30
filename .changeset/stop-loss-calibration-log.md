---
"@reddb-io/redcode": patch
---

The stop-loss now records what it decided not to do and whether its hints helped, so its calibration can be measured. A signal that System One read as no reason to intervene is logged as dismissed, and work that moves after a hint is logged as progress. `redcode debug guards` prints a Stop-loss section with how many signals were checked, how many System One let through, how many hints were given and how many were followed by progress, and its `--json` output carries the same counts.

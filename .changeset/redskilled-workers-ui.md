---
"opencode": patch
---

Surface redskilled status more clearly in the Workers tab. Adds a red "✗ N failed" badge in the header for stuck workers, a blinking dot when the daemon is live, idle-state CTAs (`[start drain]` / `[z resize]`) instead of plain text, and a "tracking Xs" indicator driven by a `trackingSince` signal that stamps on the first payload.

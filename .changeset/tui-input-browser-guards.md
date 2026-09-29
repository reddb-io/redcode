---
"@reddb-io/redcode": patch
---

Restore Ctrl+Shift+V as a paste key alongside Ctrl+V for text and images, and insert the clipboard once when a terminal both forwards the key and performs its own bracketed paste. Keep single-line pastes visible up to 250 characters before folding them. A bare Ctrl+C or Ctrl+D on an empty prompt now asks to be pressed again within two seconds before the TUI exits.

`REDCODE_NO_BROWSER` stops every browser and system-opener launch and shows the link to open instead. Design review links honor `design.browser` and `REDCODE_DESIGN_BROWSER`. Hooks and commands whose process exits without reading its input no longer crash Redcode with EPIPE. A lock left by a process that is no longer running on this host is taken over at once instead of after the stale timeout, and Windows lock contention is retried instead of failing.

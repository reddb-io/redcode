---
"@reddb-io/redcode": patch
---

Restore Redcode's sidebar widths from v0.57.0, persistent tab selection, keyboard resizing and live worker/subagent counts on the V2 TUI. Share worker status between the sidebar and full page.

Preserve the empty Context summary and separate project/worktree/branch lines, with text fitted to the sidebar width. Restore legacy sidebar keybinding names; leader+w cycles the sidebar and leader+Shift+w closes a V2 session tab.

Restore the Todo title, bracketed task markers and status colors, the original section order, and collapse controls only for lists with more than two entries.

Restore subagent model details and open/steer/kill controls using V2 prompt admission and interruption, including confirmation before stopping a child.

Restore /context, /subagents, /thinking and /timestamps. Keep /thinking as the display toggle; model effort remains available through /variants and /effort.

Preserve the historical red scrollbar and informational colors in both light and dark Redcode themes.

Restore `/pending` over the V2 durable inbox, including queued and steering prompts, timestamps, attachment counts, send-now, discard, discard-all and an explicit empty state. Keep the pending management panel available in direct mode even when the queue is empty.

---
"@reddb-io/redcode": patch
---

Restore Redcode's sidebar widths from v0.57.0 and keyboard resizing on the V2 TUI. Keep Context in the right sidebar and move Workers and Subagents into the bottom activity drawer, sharing worker status with the full management page.

Preserve the empty Context summary and separate project/worktree/branch lines, with text fitted to the sidebar width. Keep legacy sidebar keybinding names; leader+w opens the activity drawer and leader+Shift+w closes a V2 session tab.

Restore the Todo title, bracketed task markers and status colors, the original section order, and collapse controls only for lists with more than two entries.

Restore subagent model details and open/steer/kill controls using V2 prompt admission and interruption, including confirmation before stopping a child.

Restore /context, /subagents, /thinking and /timestamps. Keep /thinking as the display toggle; model effort remains available through /variants and /effort.

Preserve the historical red scrollbar and informational colors in both light and dark Redcode themes.

Restore `/pending` over the V2 durable inbox, including queued and steering prompts, timestamps, attachment counts, send-now, discard, discard-all and an explicit empty state. Keep the pending management panel available in direct mode even when the queue is empty.

Restore `/budget` and Goal cost/token budgets on the V2 runtime. Enforce session, parent-session and Goal limits before each model step, count descendant usage, and show configured limits in the Context sidebar.

Restore the RedRouter connection endpoint prompt and persist the selected API URL with its credential while continuing to read pre-migration connection metadata.

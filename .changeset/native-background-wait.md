---
"@reddb-io/redcode": patch
---

Add an optional native background wait tool when starting Claude or Codex harness runs. Bind each call to a recorded Monitor or command from that run, wait for native observations for at most 30 seconds, and distinguish observed terminal state, timeout, cancellation and unavailable observation. Interruption or closing cancels active waits; process loss marks observations unavailable. Waiting issues no task-control commands. Retain the latest wait record across host restart and show it in Delivery. Existing runs remain unchanged unless the tool is explicitly enabled; Codex uses its experimental dynamic-tool protocol. Prevent late native frames from reopening a closed execution.

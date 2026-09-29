---
"@reddb-io/redcode": minor
---

Add a Monitors tab to the TUI composer drawer. It lists the session's monitors, running ones first, with their state (running, succeeded, timed out, failed, cancelled), what they watch (the polled command or the probe, such as `probe: GET https://…`), the time left before the deadline, the last result or matched condition on one line, and whether the result was delivered. Enter expands the full evidence and ctrl+d stops a running monitor; the external job keeps running. `/monitors` now opens the drawer on this tab instead of a separate dialog.

While a monitor runs, the prompt footer shows "N monitors", and a monitor that finishes while the tab is out of sight shows a short toast with its outcome. Sessions without monitors show neither. The list refreshes when a monitor starts or reports, when the session goes idle, and every two seconds only while the tab is open or a monitor is running. Add a storybook story for the tab.

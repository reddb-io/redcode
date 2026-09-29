---
"@reddb-io/redcode": minor
---

RedRouter now hears what System One made of each request: the prompt classification sends `x-red-router-hint` (complexity, deliberation, tier, the user's feedback and frustration, and `needs_tool` when a skill was recommended) and turns the router's own decision layer off when System One already chose a skill. A router that reports no active account for the model is no longer retried: the turn ends with a message saying to connect one in the router's dashboard.

Monitors announce themselves: `monitor.started`, `monitor.finished` and `monitor.expired` are published on the event stream, and the TUI Monitors tab and prompt footer indicator follow them instead of re-reading on heuristics and a background timer (the tab still re-reads while it is open and a monitor runs). A finished monitor no longer wakes a Session whose originating turn was interrupted, whose goal is paused or blocked, or whose person wrote since it started; its result waits for the next turn and says which of those happened. A monitor that ended without a result says the watched state is unknown.

A router catalog refresh that changes the model list publishes `provider.catalog.updated`, and the TUI shows a toast such as `RedRouter catalog updated: +2/−1 models`.

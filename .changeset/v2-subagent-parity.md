---
"@reddb-io/redcode": patch
---

The V2 session runtime now matches the legacy runtime in five places. It keeps a subagent's result verdict and its last 20 stop-loss checkpoints in the child session's metadata, so the sidebar and task rows show them. It reads the subagent caps from the legacy config keys `subagent_depth`, `experimental.subagent_limits` and `experimental.background_subagents_max`, also when the config file uses the legacy format. It marks an S1 response repair so surfaces show the revised answer as one reply. It also starts design-system identification as soon as the design agent runs or S1 routes the request as design.

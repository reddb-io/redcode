---
"@reddb-io/redcode": minor
---

Add server usage reporting in Settings with signed webhooks and RedDB queue delivery. Persist numeric usage facts and session summaries for native and ACP-accessed sessions, System One evaluations and installed Claude/Codex harnesses. Reports exclude conversation content, code, paths, tool arguments/results and credentials. Deliveries retain stable IDs, frozen destinations and credentials across retries and restart; administration requires infrastructure owner-admin access. Unknown usage remains explicit and cumulative snapshots replace earlier summaries.

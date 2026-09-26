---
"@reddb-io/redcode": patch
---

Continue the V2 session cutover: the V2 runner now feeds the V1 read path. A message mirror converts projected V2 messages into the V1 `MessageTable`/`PartTable` rows and republishes the live-only `message.updated`/`message.part.updated` wire events clients render, so sessions driven by the V2 runtime keep working in the TUI and the app. The `experimental.session_engine` config (`v1` default, `v2`) routes new prompts through the durable V2 admission. Also fixes the app prompt placeholders, provider custom errors and the design mount tests after the i18n removal.

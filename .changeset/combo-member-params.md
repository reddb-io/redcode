---
"@reddb-io/redcode": patch
---

Follow the member that serves a RedRouter fallback combo. Discovery now keeps each combo's `parameters_basis` and `member_parameters`. When a response reports that a member other than the lead served it, the session switches to that member's context window (used for compaction), output limit, thinking levels (in the variant picker too), `thinking_can_disable` and forced tool choice. It switches back when the lead serves again. The member's parameters come from the saved catalog. A member missing from it is read once from `GET /v1/models/<id>`. The switch lives only in session memory: it never writes config or moves the catalog version. Combos whose parameters are the strictest member's, and RedRouters older than per-member parameters, behave as before.

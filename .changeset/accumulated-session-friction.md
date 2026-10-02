---
"@reddb-io/redcode": patch
---

Track accumulated friction with the agent's work instead of averaging sentiment or satisfaction. Repeated corrections and unresolved failures raise the Context thermometer from 0 to 5; neutral continuation preserves it and confirmed improvement cools it gradually. Display a single vertical bar filling upward beside Context without a label or numeric score. Reuse existing S1 telemetry to guide S2 toward a more specific correction, verification, or focused clarification without extra model calls.

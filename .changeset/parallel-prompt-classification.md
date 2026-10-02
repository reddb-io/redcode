---
"@reddb-io/redcode": patch
---

Run S1 prompt classification alongside S2 without its initial wait. Apply persisted advice at subsequent Steps for the same user request, preserving user satisfaction telemetry even when feedback arrives late. Superseded advice cannot steer a newer request, and late results do not restart completed Sessions. Report post-completion S1 collection separately in the evaluation harness while retaining its tokens and cost. Performance and accuracy gains remain unmeasured.

---
"@reddb-io/redcode": patch
---

Design handoffs now evolve existing product code instead of replacing it with the prototype. A design records the product files it redesigns (`targets`), and the approved context given to Plan and Build states that the prototype is a reference, lists those files and requires an incremental migration that keeps the real data layer, current behaviors and existing tests.

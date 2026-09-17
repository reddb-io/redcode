---
"@reddb-io/redcode": patch
---

`design_read` no longer refuses with "No approved Design revision is recorded" while prototyping. Before any approval, every section (decisions, scenarios, feedback, assets, evidence, prototype, files) reads the requested or latest published revision and labels the output as not approved; after approval, the frozen package answers as before.

---
"@reddb-io/redcode": patch
---

Never send a forced tool choice to models that refuse one (Claude Opus 5.5, Fable, Mythos, or a RedRouter that declares it): session requests ask for the tool instead, and agent generation falls back to prompted JSON with one repair attempt.

---
"@reddb-io/redcode": minor
---

Add a RedRouter provider preset: `POST /provider/red-router/connect` connects a RedRouter instance like the 9Router preset, and discovery stores the router-reported context/output limits on each model so compaction and request sizing use real limits instead of guesses.

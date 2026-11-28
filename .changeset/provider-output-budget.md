---
"@reddb-io/redcode": patch
---

Stop assigning guessed output limits to models that omit them. Leave the limit to the provider when possible, recover from reported context exhaustion, and show the requested budget and reported token usage when generation stops repeatedly.

---
"@reddb-io/redcode": patch
---

Task updates no longer fail when System One cannot review them. After a provider was reconnected, System One kept pointing at the removed key and every `todowrite` failed with "Stored System One credential does not belong to this transport and API origin". System One now switches to the provider's current connection and saves it. If there is none, it says to reconnect the provider in /setup. Re-saving a provider connection now keeps its credential id. When System One is unavailable, the task update is applied and labelled unverified. An inconclusive review adds a note and no longer rejects the update. A clear refusal still keeps the previous state, and plan handoffs stay strict. Refusal messages no longer say "Previous state preserved" twice.

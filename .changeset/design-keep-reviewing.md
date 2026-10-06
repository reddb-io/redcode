---
"@reddb-io/redcode": patch
---

A pending Send & end can now be withdrawn. A later review message that does not end the review withdraws it, since the reviewer is clearly still reviewing, and the review page shows a "Keep reviewing" action next to "Ending after this round". The terminal sidebar now shows why a note was left partial or unresolved, the app's Design tab why a note was left partial, unresolved or accepted, and the terminal sidebar counts the partial and unresolved notes of earlier rounds on one line instead of dropping them when a newer round opens. The new Design round strings in the app are English only for now; other languages fall back to English until they are translated.

---
"@reddb-io/redcode-app": patch
---

Re-arm the timeline offset watch however the mutation batch is ordered

A batch that carries both the removal and the re-insertion of the scroll element can present them in either order, and the reconnect was decided record by record: with the addition first, it was judged before the removal had been seen, so the element returned to the page with nothing watching its offset. The batch is now judged as a whole.

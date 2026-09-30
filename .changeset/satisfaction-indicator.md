---
"@reddb-io/redcode": minor
---

The prompt footer now shows how the user is taking the session: a block glyph that grows across five stages (frustrated, rough, steady, good, great), coloured from red to green. It is read from what System One already classifies for every prompt, how your message judges the previous work (approves, corrects, rejects) and how frustrated it sounds, weighting the latest prompts most, so it costs no extra model call and stores nothing. It appears in dual reasoning once three prompts have been read, works in any language, and clicking it opens `/intelligence`.

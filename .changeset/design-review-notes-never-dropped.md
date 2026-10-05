---
"@reddb-io/redcode": patch
---

Deliver every note of a Design review to the agent. A review message used to be cut at 8,000 characters, so a round of 14 notes reached the agent as 7 or 8 and the rest were silently lost. The message is no longer cut: a note on an element with its own data-design-id carries no redundant locators, a long message first shortens the page text captured with each note, then leaves out backup locators, and the words the reviewer wrote are never shortened.

The agent can read a round's notes with their status, or one note with every locator, through `design_read` section `notes`. A review too long for one message is refused with a request to send it in two parts instead of being truncated, and the review page releases a refused review so its notes can be edited and sent again. The review feed reports the number of notes that were sent, including for messages stored before this change.

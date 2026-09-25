---
"@reddb-io/redcode": patch
---

Sending a prompt again while an identical one is still queued no longer adds a second copy that the model reads later as a repeated request. The waiting prompt covers both sends, and sending it again with the steer key moves it ahead of the queue. Retrying a prompt with the same message ID returns the stored message instead of moving it to the end of the conversation.

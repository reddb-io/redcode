---
"@reddb-io/redcode": patch
---

Legacy sessions admit prompts into the durable inbox before they become model-visible: a prompt sent while a turn is running is promoted at the next safe step boundary (`delivery: "steer"`, the default) or only once the session would otherwise go idle (`delivery: "queue"`), one at a time in admission order.

---
"@reddb-io/redcode": minor
---

Design mode: the conversation, live reload, ending the review, and a sheet on the phone

The review page is now a conversation: what you send and what the agent replies, queued notes as pills, Send to Agent, Hold, and Send & End; a menu with the prototype's path, reload, a DOM snapshot copy, and End review. A change on disk reloads the prototype while someone is looking, and the page keeps the person's place, their unsent card text, and answers inside `data-redcode-question` across that reload — a note whose element disappears for two revisions is handed back as text, never lost. Everything a person wrote survives a reload of the page itself. The server streams reloads, the agent's replies and presence over `/design/:id/events`; who ended the review is remembered, a person's end is not reopened by the agent unless asked (`design_preview` gains `reopen`), and `design_exit` ends the review as the agent. The review's state lives in a sidecar beside the prototype and an index in the data directory, so a restarted server still knows an open tab. Below 860px the panel becomes a sheet raised from a dock.

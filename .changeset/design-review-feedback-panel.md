---
"@reddb-io/redcode": patch
---

The Design review page's side panel is now a compact Feedback tab. The newest round's notes read as a checklist, one line per note with a status mark, and a note expands to show its element, what the agent says it changed and the recorded outcome. Settled rounds fold into one line with their tallies, "Only what is left" hides what is done, the agent's last reply stays in view with the rest of the conversation under Activity, and the message box stays pinned at the bottom.

While the agent works, the round shows how far it has come: received, fixing (how many notes are addressed), stopped, published, verifying, outcomes missing, or ready for review. Ready for review appears only once every note has an outcome on a verified latest revision and the agent is idle. The panel also shows the agent's live activity and how long ago the round was received.

A chip next to the revision picker tells you whether you are looking at the latest revision (Latest, N behind, Updating…, Load failed, Offline). A line above the preview says which round the revision on screen answers. When a newer revision has not replaced it yet, the line says why and offers the next step: add your open note and switch, or retry a send or a failed load. When you switch to the latest revision, your queued notes and message now move with you instead of staying on the old revision, so they can no longer be sent twice. Clicking a draft's Remove or Send in the message box no longer misses when the box grows.

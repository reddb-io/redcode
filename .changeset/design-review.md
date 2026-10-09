---
"@reddb-io/redcode": minor
---

Design review links no longer expire under you. The agent's replies and the terminal session now show the review's stable address (`/design/session/<id>/review`, without a ticket): it opens directly in the desktop app, in a browser paired with `redcode pair`, and in any browser that already opened the review, whose sign-in now slides forward while the review is in use instead of lapsing after 12 hours. A browser without access gets a page that explains how to get in (the Design panel, `redcode design <id>` for a fresh link, or `redcode pair`) instead of a JSON error, and an open review that loses access says so in a banner instead of going quiet. Short-lived ticket links remain for sharing with another device or an unpaired browser, and the ticket is dropped from the address once it is used.

The Design agent has a new `design_link` tool that returns the review link without publishing, plus fresh share links when the user asks to share; it is told to use it, never a republish or a restart, when a link does not open.

In the desktop app, Open review in the Design panel now shows the review beside the session in the built-in browser, signed in with the desktop's own server credential (sent only to that session's review on the server's origin). This embedded review leaves out the agent's reply, the round message and the Activity transcript that the session already shows; the preview, variants, screens, devices, params, notes and approval stay. Open in system browser keeps the full review one click away.

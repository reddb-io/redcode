---
"@reddb-io/redcode": minor
---

Design can run in its own process. With `design.app.mode: "process"`, redcode starts `redcode-design` on demand (from `REDCODE_DESIGN_BIN`, or from source in a checkout), finds it again through a private registration file and talks to it with a private token; the app serves the review page, the presenter and the previews, runs builds, renders and exports, reaches the conversation back through `design.host`, and exits after ten idle minutes. Review links carry a short-lived signed ticket that the app exchanges for a session cookie, so windows the review opens, such as the presenter, need no credentials of their own. The default stays `"inline"`, which runs everything inside redcode as before.

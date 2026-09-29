---
"@reddb-io/redcode": patch
---

Open the Design review in Chrome or Chromium again when one is installed, as the schema already promised: the TUI, `redcode design` and the app pick an installed Chrome, then Chromium, else the system browser, without starting anything to find them. `design.browser` (or `REDCODE_DESIGN_BROWSER`) now also accepts `chrome` and `chromium` to pick that family, and `app` to open the review as a Chromium app window (`--app=<url>`) without tabs or an address bar; `default` keeps the system browser, and an app name or executable path works as before. A picked browser that fails to start falls back to the system browser, and WSL keeps the Windows default browser.

The web and desktop app now claim the review launch through the server like the TUI, so a review already open in another tab or requested moments ago from any surface is reported instead of opened twice. The web app opens the tab on the click itself, so a popup blocker no longer swallows it; when the tab is blocked anyway, the toast carries the link with an Open review action. `redcode design <session>` claims its launch the same way and still prints the link first. Review links follow the address the client reached the server at, so a client on another device gets a link it can open, and a client that connected to a wildcard bind address gets loopback instead of `0.0.0.0`.

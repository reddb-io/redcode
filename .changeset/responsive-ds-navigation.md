---
"@reddb-io/redcode": patch
---

Use labelled design-system navigation on desktop, with a persistent Navigation labels preference in Settings. The rail and resizable sidemenu now share an intrinsic grid track, so changing labels or density keeps the content aligned.

Add a full-width mobile navigation dock with Home, Browse, Agents, Search and More. The dock reserves space below the composer, keeps running-session badges, and shares the existing navigation actions and server scopes. Retain safe-area clearance and the bottom titlebar preference, and return focus to Browse when the contextual sidebar is dismissed.

Restore the connected opener when a programmatically opened dialog closes, while respecting explicit focus callbacks. Closing Search from the dock returns keyboard focus to Search.

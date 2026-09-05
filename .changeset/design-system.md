---
"@reddb-io/redcode": minor
---

Design mode: the project's design system, read and handed over

On entering the `design` agent, redcode reads `DESIGN.md` or `.red/DESIGN.md` from the project and puts it in the mode's prompt. When neither exists it scans the repository — framework and component library from `package.json`, the token block from the stylesheet that declares the most custom properties, fonts, a few styled pages to read, an existing design doc — and writes `.red/DESIGN.md` with what it found, so the summary can be corrected once and believed from then on.

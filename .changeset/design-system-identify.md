---
"@reddb-io/redcode": minor
---

Design now identifies the project's design system as the first step of a new design when `design.system` is not configured, or when its configured paths no longer exist. A bounded, read-only evidence pack (pruned folder tree, stylesheets with tokens, Tailwind/token/theme files, component directories, Storybook and DESIGN.md) lets System One confirm, correct or reject the heuristic scan in dual reasoning (new `design_system_detect` operation); in single reasoning the design agent reads the pack from `design_document` detect and reports its conclusion on create, with no System One call. The adoption question shows a one-line result such as "Design system: Tailwind theme (shadcn/ui) at src/components/ui, src/app/globals.css (90%, System One)" with the reason, and results are cached per project until the scanned files change.

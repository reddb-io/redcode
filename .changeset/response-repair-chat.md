---
"@reddb-io/redcode": patch
---

Stop the agent from answering itself after a simple reply in dual reasoning. System One's response review now repairs only issues it establishes with high confidence, repairs each issue at most once, and stops when the revision changes nothing material. Checks that need tool results, tasks or an active goal are no longer asked without them, and a plain answer turn with none of them is not reviewed. In the TUI, a revised answer collapses into its revision with a short "revised after S1 review" line.

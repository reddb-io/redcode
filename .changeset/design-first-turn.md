---
"@reddb-io/redcode": minor
---

Design settles its target and design system faster. In dual reasoning, the per-message classification now also reads the design target (web, app with its platform, or presentation) when it routes a request to design, so creating the design makes no separate `design_target` call. Design-system identification starts in the background as soon as the design agent runs or a message is routed to design. When System One is at least 85% sure and agrees with the design agent (target), or with the file scan (design system), nothing is asked: the design shows a compact chip such as "iOS app · DS: shadcn/ui (packages/ui)", and you can change it with `design_document` update or refresh. The last target you settled in a project is preselected for its next design.

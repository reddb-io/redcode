---
"@reddb-io/redcode": patch
---

Name design review notes by where they are, not only by what they are

A note left on an icon, a name shown in several places or a close button used to reach the chat as `svg`, `span "Filipe"` or `button "Close"`, and the agent guessed which one was meant. Every note is now labelled as a breadcrumb through its named ancestors, innermost first, such as `svg in button "Close" in dialog "New conversation"` or `span "Filipe" in li "Filipe" in aside "Conversations" (2 of 2)`, with a position only when several elements share the breadcrumb; a `data-design-id` or `id` on the element or an ancestor leads the label and the selector. Each note also carries a `Parent:` line naming the parent and grandparent with their XPaths, the transcript notice shows the same breadcrumb, and the review message asks the agent once to add a `data-design-id` when it edits an element referenced without one. The Design prompt now requires ids on every interactive element, icon-only button, landmark and repeated item.

---
"@reddb-io/redcode": minor
---

Approve and reopen a design from the app's Design tab. A design whose review is open shows Approve, which asks for confirmation before approving its published revision as a whole and handing the session to Plan; an ended review shows Reopen review. A refused approval, such as a feedback round whose notes have no recorded outcome yet, shows the server's reason in an error toast, and the list refreshes after each action. The new strings ship in English and Brazilian Portuguese.

The browser review message and the approval handoff line are now written and read back from one shared definition, so the terminal and app transcript cards can no longer drift from what the Design agent receives.

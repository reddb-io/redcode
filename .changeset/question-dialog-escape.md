---
"@reddb-io/redcode": patch
---

Question and permission dialogs are easier to get out of when the server is slow or failing.

- **Slow replies:** if the server doesn't take a reply within 10 seconds (30 seconds for a remote server), the TUI checks whether the request is still pending. If it is, the dialog stays open and says it is still waiting. If not, the dialog closes and warns that your answer may still be applied.
- **Errors:** a request that no longer exists closes the dialog. Any other error keeps it open so you can try again.
- **Ctrl+C:** pressing it twice on the same dialog within 5 seconds exits, even while a dismiss is still pending. Dismissing one dialog never makes the next one exit.
- **Plan approval:** time spent reading a plan approval or answering a permission prompt no longer counts against the tool deadline. Before, a long read stopped plan_exit and left the approval dialog stale. Waits are tracked per session, so a subagent that reuses a provider's call ID doesn't affect its parent.

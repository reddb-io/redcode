---
"@reddb-io/redcode": minor
---

With dual reasoning, System One now also reads each new message for secrets or personal data written in prose that pattern detection cannot catch, such as "my password is …". It only ever sees the message after vaulted values became `{vault:name}` and recognized secrets became `[redacted:kind]`, and it judges that one message on its own. A message it flags is kept out of compaction summaries, their anchors and recent context, and titles from then on, and the TUI and the web app show a notice under it and a toast. The notice says the message is still in the current conversation, that the original stays in your local history and was already sent to your provider, and that anything real should be rotated. An answer System One could not give, or gave without a clear lead, counts as not checked, never as clean.

Remove from context, in the message actions, in `/restricted` or under the notice in the web app, replaces a message with `[message withheld: restricted content]` in every later request to the model. It is never automatic, since the message may carry an instruction you still want, and stored history is not rewritten.

Before a compaction checkpoint is saved, System One also reviews the checkpoint on its own for restricted content. A flagged checkpoint is rewritten once without it; if that fails or is flagged again, the pattern redaction that always runs is what protects it. An unavailable review neither approves nor blocks the checkpoint.

The vault notice now says that the replaced secrets are no longer part of the context sent to the model from now on.

---
"@reddb-io/redcode": patch
---

Stop the stop-loss from interrupting productive work. Different edits, task updates and commands that print nothing return the same acknowledgement whatever they did, so a run of them is no longer a repeated result; the same call with the same arguments, failures that repeat and read-only checks that keep answering the same still are. Spend counts only the new context a step read uncached, measured against the largest context earlier in the turn, so a provider that reports its cache differently between steps or a step without usage no longer looks like hundreds of thousands of new tokens, and token spend needs the steps to have cost at least $0.10 when they report a cost.

System One's checkpoint answers are read one by one on how far the chosen answer leads the next, so an unsure state no longer discards a sure decision. System One continues a session it reads as progressing and ends a turn only on a sure stop or question backed by a stop-loss signal and a state that is not progress; otherwise it can only steer. An unsure System One falls back to the same rules as single reasoning, and those checkpoints are labelled `Stop-loss` instead of `Stop-loss (unverified)`. Task quality reviews accept a task that System One reads as more likely sound, instead of noting every question it answered above 0.1.

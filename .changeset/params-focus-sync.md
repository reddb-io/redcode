---
"@reddb-io/redcode": patch
---

Keep a Design param field you are editing from being overwritten by the prototype

The Params panel re-synchronises its fields whenever the prototype reports its
state. That report arrives asynchronously, so a value typed right after a click
in the preview could be replaced before it was applied and the edit was lost.
A focused field now keeps the typed value until its change event fires.

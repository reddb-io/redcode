---
"@reddb-io/redcode": patch
---

Design review notes now point at exactly one element. Each note carries a selector that resolves to only the clicked element, an XPath and the surrounding containers, and its label uses the element's label, placeholder or position (for example `input[type=text] (2 of 3 inputs in section "Filters")`) instead of a bare `input`. Design agents are asked to give reviewable elements a stable `data-design-id`.

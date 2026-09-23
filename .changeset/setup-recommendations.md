---
"@reddb-io/redcode": minor
---

Setup recommends models from a connected RedRouter. When the router advertises recommendations, Redcode reads its `/v1/catalog` with the provider's key (cached per catalog version, skipped after 3 seconds or on any error) and `/setup`, `redcode setup` and the web settings list "Recommended: <model> · via RedRouter · <provider>" first, with the router's reason, preselected for the S2 principal and the transformations model. The detected RedRouter's S1 option uses the router's recommended System One model.

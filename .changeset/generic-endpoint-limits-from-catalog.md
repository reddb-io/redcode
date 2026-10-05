---
"@reddb-io/redcode": patch
---

Models on an OpenAI-compatible endpoint added through the connect wizard no longer get a 115,200-token window frozen into the global configuration when the endpoint does not report one. The wizard writes only the limits the endpoint reported or you entered; everything else is resolved from the models catalog every time the provider loads, so a model the catalog knows (glm-5.3-flash, mimo-v2.6-pro, ...) gets its real window and a configuration that an older version froze the guess into heals on load. The catalog lookup now tolerates the id shapes gateways use (case, leading vendor segments, `:free`/`:thinking`/`@region` suffixes, dots against dashes) without ever matching a bare family name.

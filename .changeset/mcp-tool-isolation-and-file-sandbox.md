---
"@reddb-io/redcode": patch
---

Keep valid MCP tools available when a server lists malformed definitions. Validate each tool with the negotiated MCP schema, report skipped definitions, and preserve pagination and page-level validation.

Sandbox repository file responses and disable MIME sniffing so HTML and SVG previews cannot execute as API-origin documents. Preserve those protections on cached, partial, HEAD and unsatisfiable-range responses.

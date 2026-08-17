---
"opencode": patch
---

Reject provider config that sets `npm` when the resolved provider package disagrees, instead of silently dropping the override. A `providers.<id>` block could override the endpoint (through `api.url` or `request.body.baseURL`) while its `npm` key was discarded as an unknown property, so the catalog's SDK was combined with the configured host into an endpoint neither source describes — for example the Anthropic `/v1/messages` path sent to an OpenAI-compatible host. The conflict now fails at config resolution with a message naming the requested package, the resolved package, and the URL the request would have used.

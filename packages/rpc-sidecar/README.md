# Redcode RPC sidecar

`redcode-rpc-sidecar` bridges `Content-Length` framed stdin/stdout messages to a Redcode `POST /rpc` endpoint.

Set `REDCODE_RPC_URL` to the exact endpoint URL. Authentication uses `REDCODE_AUTHORIZATION` when present, otherwise HTTP Basic credentials from `REDCODE_SERVER_USERNAME` and `REDCODE_SERVER_PASSWORD`, falling back to `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` (or `OPENCODE_PASSWORD`). The default username for the V2 server is `opencode`.

Frames use `Content-Length: <bytes>\r\n\r\n<body>`. Headers are limited to 8 KiB and bodies to 1 MiB. Requests are processed sequentially, redirects are not followed, and responses use the same framing.

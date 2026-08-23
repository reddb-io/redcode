# Redcode RPC sidecar

`redcode-rpc-sidecar` bridges `Content-Length` framed stdin/stdout messages to a Redcode `POST /rpc` endpoint.

Set `REDCODE_RPC_URL` to the exact endpoint URL. Authentication uses `REDCODE_AUTHORIZATION` when present, otherwise HTTP Basic credentials from `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`.

Frames use `Content-Length: <bytes>\r\n\r\n<body>`. Headers are limited to 8 KiB and bodies to 1 MiB. Requests are processed sequentially, redirects are not followed, and responses use the same framing.

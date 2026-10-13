---
"@reddb-io/redcode": minor
---

Make the remote pairing relay an explicit choice, support self-hosted OpenTunnel-compatible APIs,
and persist a separate Redcode identity for each relay. Pairing remembers the selected relay;
headless first-time setup requires an explicit relay instead of silently using the hosted service.
Previously enabled hosted connections retain their address, and switching relays provisions the
new connection before replacing an existing one.

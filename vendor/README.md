# vendor

Dependencies that exist nowhere durable.

- `solidjs-start-2.0.0-devinxi.0.tgz` — the `@solidjs/start` build upstream opencode pins as
  `https://pkg.pr.new/@solidjs/start@dfb2020`. pkg.pr.new is a preview CDN and answers 404 from
  some edges, which is how the 0.14.0 and 0.15.0 publishes lost their macOS sidecars mid-install.
  Same bytes (the lockfile's sha512 did not change), fetched from this repository instead.
  `console/app` still depends on this build's API (`RequestEvent.locals`, `APIEvent`), so moving to
  the published 2.x is a code change, not a pin change.

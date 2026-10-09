---
"@reddb-io/redcode": patch
---

npm installs no longer include Redcode Desktop: the desktop app is too large for the npm registry. Install Redcode with mise (`mise use -g github:reddb-io/redcode@latest`) or from the release archive at https://github.com/reddb-io/redcode/releases to get the desktop app; in an npm install, `redcode desktop` now says so instead of looking for a desktop package.

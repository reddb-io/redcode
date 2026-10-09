---
"@reddb-io/redcode": minor
---

The server API gains what the web and desktop interface needs: `POST /api/vcs/init` initializes Git or Mercurial in a
project without version control, integrations can declare an external connection method whose credential lives outside
Redcode, `GET`/`POST /api/credential` list and create stored credentials, and a request for a missing project folder
now returns `404 LocationNotFoundError` instead of a server error. Listing a missing directory returns
`FileNotFoundError`, a failed session's idle marker carries its error, and in-app browser tools stay hidden until a
desktop browser attaches.

---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
---

The project's own directory is `.red/code`, and the user's is `~/.red/code`

Redcode's files inside a repository move from `.redcode` to `.red/code`, beside whatever else the RedDB family keeps under `.red/`: config, agents, skills, themes, plugins, plans and designs. The user-level home moves the same way, from `~/.red/redcode` to `~/.red/code`, and is renamed once on the next start; if that cannot be done the old directory is kept and used as it is. An older Redcode run after that rename does not see the move and starts a new, empty home.

Nothing in a repository is migrated. `.redcode` and `.opencode` are still read, and a file already in one is still written there, so a repository that has either keeps working and a plan or design written before the change is found where it was left. When more than one exists, the newer name wins: `.opencode`, then `.redcode`, then `.red/code`.

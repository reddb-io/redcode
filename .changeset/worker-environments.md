---
"@reddb-io/redcode": minor
---

Prepare isolated remote worker workspaces from Agents in the desktop and web app. Infrastructure administrators can build a verified server image, clone a public HTTPS Git repository at a recorded base commit, prepare a dedicated worktree and register it with a coordinator. Each workspace has private volumes and credentials, a pinned image, non-root execution, a read-only system and enforced CPU, memory and process limits. An isolated internal network uses a separate gateway for public HTTPS and denies private, loopback and metadata destinations. Stop, archive, restore and confirmed deletion preserve explicit execution ownership and workspace lifecycle; incomplete preparation is not automatically replayed. Private Git authentication, virtual machine isolation, disk quotas and hosted fleet provisioning remain separate work.

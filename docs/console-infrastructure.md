# Infrastructure ownership and organization access

Implemented in source, unreleased. Existing running servers are unchanged until started with the updated build and access configuration.

Infrastructure membership and organization membership are separate. A person can have both; neither role automatically grants the other.

| Scope | Role | Authority |
| --- | --- | --- |
| Infrastructure owner | admin | Register servers/workers, manage infrastructure members, grant/revoke checkout access, administer the bound host APIs. |
| Infrastructure owner | user | Submit and review their worker tasks on that owner's resources, without changing the pool, grants or host configuration. |
| Organization | admin | Manage organization workspaces/invitations and review workspace batches on resources explicitly granted by the infrastructure administrator. |
| Organization | member | Submit and review their own batches within an authorized workspace. |

The existing organization `owner` remains an organization role, including role transfer and last-owner protection. It does not confer infrastructure ownership. The infrastructure also protects its last administrator against removal, demotion and account deletion. New Console bootstrap creates independent organization-owner and infrastructure-admin memberships for its first account.

Existing databases migrate without promoting organization owners. If the installation has no infrastructure owner, an authenticated account must explicitly claim it using the local infrastructure setup code printed by the new `console serve` process. The claim is transactional and can only succeed once. Subsequent access is delegated by infrastructure administrators to existing Console accounts.

## Configure a coordinator

1. Select **Infrastructure** in the Console siderail, then **Servers & workers** in its sidemenu. Register the coordinator and each worker as separate resources. An address is optional for registration, but required to discover a resource in **Tasks**. Use HTTPS for network addresses or HTTP loopback for local development/SSH forwards.
2. Copy the coordinator's resource ID into a private access configuration, based on `docs/examples/server-access.json`.
3. Start the updated coordinator with `redcode serve --access-config <file.json>`. The same option can accompany `--service`, but must be retained in the service's launch arguments on subsequent starts. It is not automatically saved into installed service configuration.
4. Register workers through **Agents → Remote workers**, including their Console resource IDs, checkout paths and server credentials. Legacy registrations without resource IDs remain usable through the trusted owner credential, but cannot be used by Console users.
5. In **Infrastructure → Workspace grants**, grant the coordinator and each eligible worker to the desired workspace. Worker grants name exact independent checkout directories. A directory can be granted to one workspace per resource; revoke it before reassignment. Manage owner administrators and operators through **Infrastructure → Infrastructure members**; organization members remain under **Organization → Members**.
6. Sign in to the Console and select **Workspace → Tasks** for delegated work, or **Infrastructure → Tasks** for owner work. Their resource selectors remain separate. Workspace mode sends the Console session with `x-redcode-workspace`; infrastructure mode uses that account's infrastructure membership. A coordinator filters workers/checkouts and results for the selected scope. Its CORS configuration must permit the actual Console origin; `--cors <origin>` adds a deployed Console.

The optional server configuration has `consoleURL` and `resourceID`. It contains no identity-provider endpoints or shared identity secret. The configured Console origin is trusted by that server; every bearer request is checked against current Console account membership and grants over HTTPS or loopback HTTP. Raw IdP access tokens are not accepted. Console sign-out, session revocation, infrastructure demotion/removal and grant revocation take effect on subsequent API checks; a failed/unavailable Console denies delegated access.

## Execution and results

Accepted batches persist their submitting account/workspace and a frozen registry containing only allowed worker checkouts. User tokens are stored in the coordinator's existing credential store, not manifests, registry JSON, API results or batch metadata. A credential reference permits authorization checks after a coordinator restart. The existing credential store's protection applies; this feature does not introduce new encryption.

Before every new admission, including explicit recovery, the coordinator rechecks the current session and worker grant. An unverified queued task fails without creating a Session. A running task is not automatically interrupted by revocation; its checkout stays reserved until the worker settles. Listing, recovery and artifact collection are separately checked, including cached patches. Organization administrators can review workspace batches; members and infrastructure users can review their own batches. Credentials used for admission are not transferred to worker agents.

## Boundaries

- Without access configuration, an individual installation retains its trusted server-credential behavior. The server password and legacy pairing credentials are infrastructure administration credentials, with broad host access. Do not give them to ordinary organization or infrastructure users; those accounts use Console bearer sessions. Rotating the server password revokes its pairing sessions.
- Delegated users operate through the scoped worker task API. Direct shared Session, filesystem, shell, PTY, provider/configuration and global event APIs remain infrastructure-administrator only. Per-tenant interactive desktop sessions and terminals are not implemented by these worker grants.
- These grants authorize application operations, not OS sandboxing. Workers execute tools with their configured permissions under their process identity. Independent checkouts do not prevent a permitted shell command from accessing another directory. Do not treat this as hostile multi-tenant execution isolation.
- Owners must register independent physical/canonical checkouts. Path normalization rejects parent traversal and canonical textual duplicates, but does not resolve remote symlinks, bind mounts or Windows junction aliases. Resource IDs are owner-managed registrations; they are not hardware attestation.
- Do not reassign a checkout while tasks admitted under its previous grant are running. Immediate termination, reassignment fencing, quotas/resource limits and per-tenant containers remain separate work.
- The initial coordinator still runs one unfinished batch at a time. This is not a hosted SaaS deployment or a validation of physical Raspberry Pi devices.

`docs/console-federation.md` describes configurable OIDC identity. Federation does not automatically map IdP groups into infrastructure or organization roles.

# Delegation tool-use evaluation

`cases.json` is a seed set of user requests and the expected orchestration actions. It distinguishes a delegated task from an independent user-owned chat and from requests that should not start either. The unavailable-provider case asks for an explanation rather than a delegation. Action selection alone does not check whether that explanation is correct or whether a failed delegation preserves the user's provider configuration.

Capture actual tool calls from the model under test, map their names and explicit targets to the actions in the cases, and write a JSON array such as `[{"id":"review-codex","actions":[{"name":"delegate_task","target":"codex"}]}]`. Do not put credentials or private conversation text in the observations. Run:

Map `redcode_delegate_task` and native `external_delegate` with `action: "delegate"` to `delegate_task`; map the corresponding status and cancel actions to `task_status` and `task_cancel`. Native Redcode-to-Redcode delegation uses `subagent` and maps to `delegate_task` with target `redcode`. These mappings do not imply that independent chat creation is implemented by these tools.

```sh
bun evals/delegation/score.ts observations.json
```

Run from `packages/server`. Missing observations, wrong targets and extra actions fail; the council case requires two delegations. Calls are compared without ordering. The score measures action and target selection only: separately verify ownership, permissions, execution, result delivery, timeouts and unavailable-provider errors. This fixture is not a model run and establishes no model accuracy by itself. Run the same cases against each explicitly configured harness and model, record their versions and sampling settings, and compare repeated runs before claiming an improvement.

# Designer and Creator

Designer owns product flows, interface hierarchy, states, design-system composition, responsive
behavior and accessibility. Creator produces functional 3D scenes, visualizations, simulations,
media and interactive tools. Build integrates approved work into product source. Both creative
modes share Design's existing document, work root, immutable revisions and review infrastructure.

## Delivery contracts

`design_collaboration` operates on an existing document. `inspect` returns its revision, work
root and workflow version (0 for a legacy document without a contract). `define` records the
calling mode's contract with `expectedVersion`; stale writes fail without overwriting it.

Designer records `kind: "interface"`, an `objective`, nonempty `acceptance` criteria and `states`.
Creator records `kind: "artifact"`, an `objective`, nonempty `acceptance`, an `artifact` type
(`3d`, `visualization`, `simulation`, `media`, `interactive-tool`) and required `outputs`
(`preview`, `component`, `files`). These are requested deliverables, not verified outcomes.

Creator also authors extensions for Redcode as a first-class delivery: `kind: "extension"`,
`objective`, `acceptance`, `target` (`server-plugin`, `tui-plugin`, `rpc-plugin`, `skill`,
`mcp-server`), the `entry` file, declared `capabilities`, and `outputs` (`source`, `package`,
`instructions`). Source stays in the returned document work root until installation is authorized.
Authoring or publishing source does not activate host code. A UI component uses the artifact
contract and `creator_component`; it is a different runtime from a server/TUI/RPC plugin.

**Agent Extensions → Plugins** lists loaded plugins and their status; **Tools** manages the
predefined Browser Control, Computer Use, Terminal Control and Rift integrations. SDK plugins
can register additional agent tools, but their creation does not automatically add a managed
Tool card. The current plugin panel lists/checks/updates packages; a generic guided installation
flow for Creator-authored host packages remains separate work. Use the real SDK/configuration
entry point and explicit installation scope, and verify loading plus a real tool call before
reporting an extension as active.

```json
{
  "action": "define",
  "id": "design_existing_document",
  "expectedVersion": 0,
  "contract": {
    "kind": "interface",
    "objective": "A compact, accessible cube editor",
    "acceptance": ["Controls work with the keyboard", "Errors have an actionable state"],
    "states": ["ready", "WebGL unavailable"]
  }
}
```

## Handoff on the same document

Publish coherent changes with `design_preview`. From Designer:

```json
{
  "action": "handoff",
  "id": "design_existing_document",
  "expectedVersion": 1,
  "to": "creator",
  "revision": "rev_actual_latest_revision",
  "summary": "Implement the interactive cube in this editor; preserve the interface and feedback.",
  "contract": {
    "kind": "artifact",
    "objective": "A working procedural cube",
    "artifact": "3d",
    "acceptance": ["Material controls change rendered pixels", "Paused scenes do not animate"],
    "outputs": ["preview", "component"]
  }
}
```

The handoff checks permission before mutation, requires the latest published revision and
records the recipient's contract. It switches the selected agent in the same Session and
admits one durable continuation using an idempotent message ID. Retrying the same transfer
finishes it rather than adding another contract version or conversation. Use current IDs and
versions returned by the tools; the sample identifiers above are placeholders.

Creator can publish its work and return the same document with `to: "design"`. Omit `contract`
to retain Designer's existing acceptance and states. Feedback, decisions, source files and
revision lineage remain attached. Restoring an older visual revision preserves the current
workflow and its contracts. The instruction baseline carries them after resume or compaction.

Handoff neither closes review nor approves, installs or certifies the artifact. Designer's
existing user approval through `design_exit` remains the transition to Plan. Creator installs
an isolated component only when requested, using the separate `creator_component` permission
and version. Workflow versions and installed-component versions are different counters.

## Tools and scope

Designer retains interface playbooks, review/export tools and the approval transition, but
does not receive component-installation tools. Creator receives artifact authoring, media,
export, Delivery artifacts and component-management tools; it does not receive `design_exit`
or `design_playbook`. Both can inspect project code, use explicit connected MCP capabilities
under their configured policies and edit the returned prototype workspace. Native shell,
arbitrary product edits and general coding delegation belong to Build. Broad Session grants
do not restore those tools to the creative modes; explicit configured denies remain effective.

On documents with a contract, authoring tools reject updates, publication, asset imports or
generation from the other creative role. This is workflow coordination, not a distributed
filesystem lock: both modes still have scoped file-edit capabilities, and explicit user/API
actions are not turned into agent handoffs. Legacy documents remain readable and continue
their existing review flow until a contract is defined.

The tests exercise real storage, Session switching, durable inbox admission, permission denial,
retries, reverse handoff, revision restore and instruction reconstruction. They do not prove
that a live model will always produce a good artifact or that acceptance criteria passed.

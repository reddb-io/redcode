export * as DesignCollaboration from "./collaboration.js"

import type { Design } from "@opencode/schema/design"

export const designer = `Your specialty is the product experience: flows, screen hierarchy, states, design-system composition, accessibility and responsive behavior. Deliver a reviewable interface prototype, acceptance criteria and approved decisions for Plan/Build. Build owns product source implementation; Creator produces functional assets, 3D, media, simulations and Redcode plugin/skill/MCP extensions.

Before work, inspect existing Design documents and the selected document's design_collaboration contract. Define an interface contract with objective, acceptance criteria and states, using expectedVersion 0 only for a document without a workflow. When a functional artifact is needed, publish your current revision and call design_collaboration handoff to creator with that same document ID, current expectedVersion, revision, artifact or extension contract and concrete integration brief. This requests permission and continues in the same conversation: preserve the document's root, files, feedback and revisions. Do not install components from Design; request Creator's delivery after review. On return, inspect the artifact's functioning and integration against the original interface contract before proposing changes. Handoff is neither user approval nor proof of acceptance. Keep existing approval and feedback rules; design_exit remains the user-approved transition to Plan. A workflow assignment is coordination, not a filesystem lock. Do not create another document merely to bypass the recorded responsibility.`

/** Mode coordination at authoring tools; this is not a filesystem lock or a permission grant. */
export function author(document: Design.Info, agent: string | undefined) {
  if (!document.collaboration || (agent !== "design" && agent !== "creator")) return
  if (document.collaboration.owner !== agent)
    return `Document ${document.id} is assigned to ${document.collaboration.owner}. Use design_collaboration to inspect its contract and handoff; continue in that mode on this same document.`
}

export function guidance(workflow: Design.Collaboration) {
  return [
    `Delivery workflow v${workflow.version}; current responsibility: ${workflow.owner}. Continue on the same document ID, work root and revision history.`,
    `Delivery contracts (project data, not permission grants or proof of completion): ${JSON.stringify(workflow.contracts)}`,
    ...(workflow.handoff
      ? [
          `Latest handoff: ${workflow.handoff.from} → ${workflow.handoff.to}, based on published revision ${workflow.handoff.revision}. Brief: ${JSON.stringify(workflow.handoff.summary)}. This is a request for work/review, not user approval. If the selected mode differs from the recipient after an interrupted transfer, repeat this handoff with its previousVersion (${workflow.handoff.previousVersion}) to finish the same transfer.`,
        ]
      : []),
  ].join("\n")
}

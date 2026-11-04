function stageWorkspaceChange(current, candidate, matches, merge) {
  const index = current.findIndex((change) => matches(change, candidate));
  if (index < 0) return { changes: [...current, candidate], id: candidate.id };
  const changes = current.slice();
  const existing = changes[index];
  changes[index] = { ...merge(existing, candidate), id: existing.id };
  return { changes, id: existing.id };
}
function reconcileWorkspaceChanges(current, submitted, outcomes, sameRevision, rebase) {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const submittedById = new Map(submitted.map((change) => [change.id, change]));
  const failed = [];
  let applied = 0;
  for (const change of submitted) {
    const outcome = byId.get(change.id);
    if (outcome?.ok) applied++;
    else failed.push({ ...change, error: outcome?.error ?? "commit failed" });
  }
  const changes = [];
  for (const change of current) {
    const before = submittedById.get(change.id);
    if (!before) {
      changes.push(change);
      continue;
    }
    const outcome = byId.get(change.id);
    if (!sameRevision(change, before)) {
      changes.push(outcome?.ok ? rebase(change, before) : change);
    } else if (!outcome?.ok) {
      changes.push({ ...change, error: outcome?.error ?? "commit failed" });
    }
  }
  return { changes, applied, failed };
}
export {
  reconcileWorkspaceChanges,
  stageWorkspaceChange
};

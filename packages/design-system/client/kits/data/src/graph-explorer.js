const CENTRALITY_FIELDS = [
  "centrality_score",
  "centrality",
  "pagerank",
  "page_rank",
  "betweenness",
  "closeness",
  "eigenvector",
  "degree",
  "score"
];
function asString(v) {
  if (v === null || v === void 0) return "";
  return String(v);
}
function asFiniteNumber(v) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function explicitCentralityScore(node) {
  for (const field of CENTRALITY_FIELDS) {
    const n = asFiniteNumber(node.data[field]);
    if (n !== null) return n;
  }
  return null;
}
function firstString(data, fields) {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
function nestedObject(data, field) {
  const value = data[field];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) => typeof item === "string" || typeof item === "number"
  ).map((item) => String(item).trim()).filter(Boolean);
}
function graphNodeDescription(node) {
  const metadata = nestedObject(node.data, "metadata");
  return firstString(node.data, ["description", "summary", "content"]) ?? (metadata ? firstString(metadata, ["description", "summary", "content"]) : null);
}
function graphNodeExports(node) {
  const direct = stringList(node.data.exports);
  if (direct.length > 0) return direct;
  const metadata = nestedObject(node.data, "metadata");
  return metadata ? stringList(metadata.exports) : [];
}
function flagValue(data, fields) {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (["true", "yes", "1"].includes(lowered)) return true;
      if (["false", "no", "0"].includes(lowered)) return false;
    }
  }
  return null;
}
function graphNodeIsOrphan(node, centrality) {
  const metadata = nestedObject(node.data, "metadata");
  const explicit = flagValue(node.data, [
    "orphan",
    "is_orphan",
    "isOrphan",
    "dead_code",
    "deadCode"
  ]) ?? (metadata ? flagValue(metadata, [
    "orphan",
    "is_orphan",
    "isOrphan",
    "dead_code",
    "deadCode"
  ]) : null);
  if (explicit !== null) return explicit;
  return (centrality?.get(node.id)?.inDegree ?? 1) === 0;
}
function normalizeEdgeKind(edge) {
  const raw = edge.data?.kind ?? edge.data?.type ?? edge.label;
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "imports" || value === "import" || value === "imports_from")
    return "imports";
  if (value === "defines" || value === "defined_in" || value === "contains")
    return "defines";
  return "references";
}
function relationLabel(kind, direction) {
  if (kind === "imports")
    return direction === "incoming" ? "imported by" : "imports";
  if (kind === "defines")
    return direction === "incoming" ? "defined by" : "defines";
  return direction === "incoming" ? "referenced by" : "references";
}
function graphNodeDetail(node, nodes, edges, centrality) {
  const nodesById = new Map(nodes.map((entry) => [entry.id, entry]));
  const relations = [];
  for (const edge of edges) {
    const direction = edge.source === node.id ? "outgoing" : edge.target === node.id ? "incoming" : null;
    if (!direction) continue;
    const otherId = direction === "outgoing" ? edge.target : edge.source;
    const other = nodesById.get(otherId);
    const kind = normalizeEdgeKind(edge);
    relations.push({
      id: edge.id,
      kind,
      direction,
      label: relationLabel(kind, direction),
      edgeLabel: edge.label,
      nodeId: otherId,
      nodeLabel: other?.label ?? otherId
    });
  }
  const byKindThenLabel = (a, b) => a.kind.localeCompare(b.kind) || a.nodeLabel.localeCompare(b.nodeLabel) || a.nodeId.localeCompare(b.nodeId);
  const incoming = relations.filter((relation) => relation.direction === "incoming").sort(byKindThenLabel);
  const outgoing = relations.filter((relation) => relation.direction === "outgoing").sort(byKindThenLabel);
  return {
    description: graphNodeDescription(node),
    exports: graphNodeExports(node),
    orphan: graphNodeIsOrphan(node, centrality),
    incoming,
    outgoing,
    whereUsed: incoming
  };
}
function graphNodeCentrality(nodes, edges) {
  const stats = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    stats.set(node.id, {
      degree: 0,
      inDegree: 0,
      outDegree: 0,
      score: explicitCentralityScore(node) ?? 0
    });
  }
  for (const edge of edges) {
    const source = stats.get(edge.source);
    const target = stats.get(edge.target);
    if (source) {
      source.outDegree += 1;
      source.degree += 1;
    }
    if (target) {
      target.inDegree += 1;
      target.degree += 1;
    }
  }
  for (const node of nodes) {
    const stat = stats.get(node.id);
    if (!stat) continue;
    stat.score = explicitCentralityScore(node) ?? stat.degree;
  }
  return stats;
}
function compareGraphNodesByCentrality(a, b, centrality) {
  const ca = centrality.get(a.id);
  const cb = centrality.get(b.id);
  const scoreDelta = (cb?.score ?? 0) - (ca?.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  const degreeDelta = (cb?.degree ?? 0) - (ca?.degree ?? 0);
  if (degreeDelta !== 0) return degreeDelta;
  const labelDelta = a.label.localeCompare(b.label);
  if (labelDelta !== 0) return labelDelta;
  return a.id.localeCompare(b.id);
}
function graphNodeIncomingSizeScales(nodes, centrality) {
  const values = nodes.map((node) => centrality.get(node.id)?.inDegree ?? 0);
  const max = Math.max(0, ...values);
  if (max <= 0) return new Map(nodes.map((node) => [node.id, 1]));
  const counts = /* @__PURE__ */ new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const unique = [...counts.keys()].sort((a, b) => a - b);
  const ranks = /* @__PURE__ */ new Map();
  let cumulative = 0;
  for (const value of unique) {
    cumulative += counts.get(value);
    ranks.set(value, cumulative / values.length);
  }
  if (unique.length === 1) return new Map(nodes.map((node) => [node.id, 1]));
  return new Map(
    nodes.map((node) => {
      const incoming = centrality.get(node.id)?.inDegree ?? 0;
      if (incoming <= 0) return [node.id, 1];
      const percentile = ranks.get(incoming);
      if (percentile > 0.95) return [node.id, 2];
      if (percentile > 0.8) return [node.id, 1.5];
      if (percentile > 0.5) return [node.id, 1.25];
      return [node.id, 1];
    })
  );
}
function renderGraphSnapshot(graph) {
  const { nodes, edges } = graph;
  const lines = [];
  lines.push('<section class="graph">');
  lines.push(
    `<header class="summary">${nodes.length} nodes \xB7 ${edges.length} edges</header>`
  );
  lines.push('<ul class="nodes">');
  for (const n of nodes) {
    lines.push(
      `<li class="node" data-id="${escapeHtml(n.id)}">${escapeHtml(n.label)}</li>`
    );
  }
  lines.push("</ul>");
  lines.push('<ul class="edges">');
  for (const e of edges) {
    const lbl = e.label ? ` [${escapeHtml(e.label)}]` : "";
    lines.push(
      `<li class="edge">${escapeHtml(e.source)} \u2192${lbl} ${escapeHtml(e.target)}</li>`
    );
  }
  lines.push("</ul>");
  lines.push("</section>");
  return lines.join("");
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function explorerGraphData(graph) {
  const scales = graphNodeIncomingSizeScales(
    graph.nodes,
    graphNodeCentrality(graph.nodes, graph.edges)
  );
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      ...node.data.community == null ? {} : { community: String(node.data.community) },
      size: 6 * (scales.get(node.id) ?? 1),
      metadata: node.data
    })),
    edges: graph.edges.map((edge) => ({ ...edge, metadata: edge.data }))
  };
}
function filterExplorerGraph(graph, filter, hiddenTypes, limit = 25e3) {
  const term = filter.trim().toLowerCase();
  const nodes = graph.nodes.filter(
    (node) => (!term || node.label.toLowerCase().includes(term) || node.id.toLowerCase().includes(term)) && !hiddenTypes.has(graphExplorerNodeType(node))
  ).slice(
    0,
    Math.max(
      1,
      Math.min(25e3, Number.isFinite(limit) ? Math.floor(limit) : 25e3)
    )
  );
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target)
    )
  };
}
function graphExplorerTypes(graph) {
  return [
    ...new Set(graph.nodes.map((node) => graphExplorerNodeType(node)))
  ].sort();
}
function graphExplorerNodeType(node) {
  return String(node.data.node_type ?? node.data.type ?? "node");
}
export {
  compareGraphNodesByCentrality,
  explorerGraphData,
  filterExplorerGraph,
  graphExplorerNodeType,
  graphExplorerTypes,
  graphNodeCentrality,
  graphNodeDescription,
  graphNodeDetail,
  graphNodeExports,
  graphNodeIncomingSizeScales,
  graphNodeIsOrphan,
  renderGraphSnapshot
};

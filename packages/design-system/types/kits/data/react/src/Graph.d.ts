import { type GraphInteraction } from "../../src/graph";
import type { GraphContract } from "../../src/core/contracts/graph";
export { GRAPH_COLOR_TOKENS, GRAPH_EDGE_LABEL_MAX_LENGTH, GRAPH_EDGE_COLOR_TOKEN, GRAPH_FOCUSED_SCALE, GRAPH_FOCUS_PULSE_SCALE, GRAPH_ENGINE_STAGE_PADDING, GRAPH_LAYOUT_GRAVITY, GRAPH_LAYOUT_ITERATIONS_PER_NODE, GRAPH_LAYOUT_MAX_ITERATIONS, GRAPH_LAYOUT_MIN_AXIS_FILL, GRAPH_LAYOUT_MIN_ITERATIONS, GRAPH_LAYOUT_SCALING_RATIO, GRAPH_MUTED_COLOR_TOKEN, GRAPH_NEIGHBOUR_LABEL_LIMIT, GRAPH_NEIGHBOUR_SCALE, GRAPH_REST_SCALE, GRAPH_SUPERNODE_BASE_SIZE, GRAPH_SUPERNODE_MEMBER_SCALE, analyseGraphStructure, applyGraphLevelOfDetail, collapseGraphCommunities, countGraphEdgeCrossings, countGraphNodeOverlapRatio, deriveGraphLevelOfDetail, detectGraphCommunities, filterGraphBackbone, graphNormalizedStress, groupGraphCommunities, layoutGraphByCentrality, layoutGraphBySparseStress, partitionGraphByCentrality, rankGraphByBetweenness, reduceGraphFocus, searchGraphNodes, shapeGraphData, } from "../../src/graph";
export type { GraphColorToken, GraphBackboneOptions, GraphBetweennessOptions, GraphBetweennessRank, GraphCentralityLayout, GraphCentralityLayoutOptions, GraphCommunity, GraphCommunityDetectionOptions, GraphData, GraphEdge, GraphInteraction, GraphLevelOfDetail, GraphLevelOfDetailOptions, GraphLevelOfDetailProfile, GraphMetadata, GraphPoint, GraphCentralityPartition, GraphCentralityPartitionWork, GraphSparseStressLayout, GraphSparseStressLayoutOptions, GraphStructureAnalysis, GraphStructureAnalysisOptions, FocusedGraphData, FocusedGraphEdge, FocusedGraphNode, GraphFocusViewport, GraphNode, ShapedGraphData, ShapedGraphEdge, ShapedGraphNode, } from "../../src/graph";
export type { GraphLayout } from "../../src/graph";
export interface GraphProps extends GraphContract {
    /** Reports caller-owned focus. */
    onFocusedNodeChange?: (id: string | null) => void;
    /** Reports community expansion. */
    onCollapsedCommunitiesChange?: (communities: readonly string[]) => void;
    /** Reports discrete graph interaction with caller metadata. */
    onInteraction?: (interaction: GraphInteraction) => void;
    /** Additional root classes. */
    className?: string;
}
export declare function Graph(props: GraphProps): import("react").JSX.Element;
export default Graph;

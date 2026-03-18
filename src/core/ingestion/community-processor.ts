/**
 * Community Detection Processor
 *
 * Thin orchestration seam for community detection. Graph construction,
 * clustering, and heuristic labeling live in dedicated support owners.
 */

import { KnowledgeGraph } from '../graph/types.js';
import { buildCommunityGraphologyGraph, countCommunitySymbols, runLeidenDetection } from './community-graph-support.js';
import { createCommunityMemberships, createCommunityNodes } from './community-label-support.js';
import type { CommunityDetectionResult, CommunityMembership, CommunityNode } from './community-types.js';

export type { CommunityDetectionResult, CommunityMembership, CommunityNode };

// ============================================================================
// COMMUNITY COLORS (for visualization)
// ============================================================================

export const COMMUNITY_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#14b8a6', // teal
  '#84cc16', // lime
];

export const getCommunityColor = (communityIndex: number): string => {
  return COMMUNITY_COLORS[communityIndex % COMMUNITY_COLORS.length];
};

export const processCommunities = async (
  knowledgeGraph: KnowledgeGraph,
  onProgress?: (message: string, progress: number) => void
): Promise<CommunityDetectionResult> => {
  onProgress?.('Building graph for community detection...', 0);

  const symbolCount = countCommunitySymbols(knowledgeGraph);
  const isLarge = symbolCount > 10_000;
  const graph = buildCommunityGraphologyGraph(knowledgeGraph, isLarge);

  if (graph.order === 0) {
    return {
      communities: [],
      memberships: [],
      stats: { totalCommunities: 0, modularity: 0, nodesProcessed: 0 },
    };
  }

  const nodeCount = graph.order;
  const edgeCount = graph.size;

  onProgress?.(`Running Leiden on ${nodeCount} nodes, ${edgeCount} edges${isLarge ? ` (filtered from ${symbolCount} symbols)` : ''}...`, 30);
  const details = await runLeidenDetection(graph, isLarge, () => {
    onProgress?.('Community detection timed out, using fallback...', 60);
  });

  onProgress?.(`Found ${details.count} communities...`, 60);
  const communityNodes = createCommunityNodes(details.communities as Record<string, number>, graph, knowledgeGraph);

  onProgress?.('Creating membership edges...', 80);
  const memberships = createCommunityMemberships(details.communities as Record<string, number>);

  onProgress?.('Community detection complete!', 100);

  return {
    communities: communityNodes,
    memberships,
    stats: {
      totalCommunities: details.count,
      modularity: details.modularity,
      nodesProcessed: graph.order,
    },
  };
};

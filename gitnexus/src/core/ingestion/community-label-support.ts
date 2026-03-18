import { KnowledgeGraph } from '../graph/types.js';
import { CommunityMembership, CommunityNode, compareStrings } from './community-types.js';

export const createCommunityMemberships = (communities: Record<string, number>): CommunityMembership[] => {
  const memberships: CommunityMembership[] = [];
  Object.entries(communities).forEach(([nodeId, communityNum]) => {
    memberships.push({
      nodeId,
      communityId: `comm_${communityNum}`,
    });
  });
  return memberships;
};

export const createCommunityNodes = (
  communities: Record<string, number>,
  graph: any,
  knowledgeGraph: KnowledgeGraph
): CommunityNode[] => {
  const communityMembers = new Map<number, string[]>();

  Object.entries(communities)
    .sort(([nodeIdA, commNumA], [nodeIdB, commNumB]) => commNumA - commNumB || compareStrings(nodeIdA, nodeIdB))
    .forEach(([nodeId, communityNum]) => {
      if (!communityMembers.has(communityNum)) {
        communityMembers.set(communityNum, []);
      }
      communityMembers.get(communityNum)!.push(nodeId);
    });

  const nodePathMap = new Map<string, string>();
  for (const node of knowledgeGraph.iterNodes()) {
    if (node.properties.filePath) {
      nodePathMap.set(node.id, node.properties.filePath);
    }
  }

  const communityNodes: CommunityNode[] = [];
  [...communityMembers.keys()].sort((a, b) => a - b).forEach((communityNum) => {
    const memberIds = communityMembers.get(communityNum)!.slice().sort(compareStrings);
    if (memberIds.length < 2) return;

    const heuristicLabel = generateHeuristicLabel(memberIds, nodePathMap, graph, communityNum);
    communityNodes.push({
      id: `comm_${communityNum}`,
      label: heuristicLabel,
      heuristicLabel,
      cohesion: calculateCohesion(memberIds, graph),
      symbolCount: memberIds.length,
    });
  });

  communityNodes.sort((a, b) =>
    b.symbolCount - a.symbolCount ||
    compareStrings(a.label, b.label) ||
    compareStrings(a.id, b.id)
  );

  return communityNodes;
};

const generateHeuristicLabel = (
  memberIds: string[],
  nodePathMap: Map<string, string>,
  graph: any,
  communityNum: number
): string => {
  const folderCounts = new Map<string, number>();

  memberIds.slice().sort(compareStrings).forEach((nodeId) => {
    const filePath = nodePathMap.get(nodeId) || '';
    const parts = filePath.split('/').filter(Boolean);

    if (parts.length >= 2) {
      const folder = parts[parts.length - 2];
      if (!['src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers'].includes(folder.toLowerCase())) {
        folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
      }
    }
  });

  const bestFolder = [...folderCounts.entries()]
    .sort(([folderA, countA], [folderB, countB]) => countB - countA || compareStrings(folderA, folderB))[0]?.[0] || '';

  if (bestFolder) {
    return bestFolder.charAt(0).toUpperCase() + bestFolder.slice(1);
  }

  const names: string[] = [];
  memberIds.forEach((nodeId) => {
    const name = graph.getNodeAttribute(nodeId, 'name');
    if (name) names.push(name);
  });

  if (names.length > 2) {
    const commonPrefix = findCommonPrefix(names);
    if (commonPrefix.length > 2) {
      return commonPrefix.charAt(0).toUpperCase() + commonPrefix.slice(1);
    }
  }

  return `Cluster_${communityNum}`;
};

const findCommonPrefix = (strings: string[]): string => {
  if (strings.length === 0) return '';

  const sorted = strings.slice().sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let index = 0;
  while (index < first.length && first[index] === last[index]) {
    index++;
  }

  return first.substring(0, index);
};

const calculateCohesion = (memberIds: string[], graph: any): number => {
  if (memberIds.length <= 1) return 1.0;

  const sortedMemberIds = memberIds.slice().sort(compareStrings);
  const memberSet = new Set(sortedMemberIds);
  const sample = sortedMemberIds.length <= 50 ? sortedMemberIds : sortedMemberIds.slice(0, 50);

  let internalEdges = 0;
  let totalEdges = 0;

  for (const nodeId of sample) {
    if (!graph.hasNode(nodeId)) continue;
    graph.forEachNeighbor(nodeId, (neighbor: string) => {
      totalEdges++;
      if (memberSet.has(neighbor)) {
        internalEdges++;
      }
    });
  }

  if (totalEdges === 0) return 1.0;
  return Math.min(1.0, internalEdges / totalEdges);
};

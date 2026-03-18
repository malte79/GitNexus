import { GraphNode } from '../graph/types.js';
import { CommunityMembership } from './community-types.js';
import {
  ProcessDetectionResult,
  ProcessNode,
  ProcessStep,
  capitalize,
  compareStrings,
  sanitizeId,
} from './process-types.js';

export const createProcessDetectionResult = (
  traces: string[][],
  memberships: CommunityMembership[],
  nodeMap: Map<string, GraphNode>,
  entryPointsFound: number
): ProcessDetectionResult => {
  const membershipMap = new Map<string, string>();
  memberships.forEach((membership) => membershipMap.set(membership.nodeId, membership.communityId));

  const processes: ProcessNode[] = [];
  const steps: ProcessStep[] = [];

  traces.forEach((trace, index) => {
    const entryPointId = trace[0];
    const terminalId = trace[trace.length - 1];

    const communitiesSet = new Set<string>();
    trace.forEach((nodeId) => {
      const community = membershipMap.get(nodeId);
      if (community) communitiesSet.add(community);
    });
    const communities = Array.from(communitiesSet).sort(compareStrings);

    const processType = communities.length > 1 ? 'cross_community' : 'intra_community';
    const entryNode = nodeMap.get(entryPointId);
    const terminalNode = nodeMap.get(terminalId);
    const entryName = entryNode?.properties.name || 'Unknown';
    const terminalName = terminalNode?.properties.name || 'Unknown';
    const heuristicLabel = `${capitalize(entryName)} → ${capitalize(terminalName)}`;
    const processId = `proc_${index}_${sanitizeId(entryName)}`;

    processes.push({
      id: processId,
      label: heuristicLabel,
      heuristicLabel,
      processType,
      stepCount: trace.length,
      communities,
      entryPointId,
      terminalId,
      trace,
    });

    trace.forEach((nodeId, stepIndex) => {
      steps.push({
        nodeId,
        processId,
        step: stepIndex + 1,
      });
    });
  });

  const crossCommunityCount = processes.filter((process) => process.processType === 'cross_community').length;
  const avgStepCount = processes.length > 0
    ? processes.reduce((sum, process) => sum + process.stepCount, 0) / processes.length
    : 0;

  return {
    processes,
    steps,
    stats: {
      totalProcesses: processes.length,
      crossCommunityCount,
      avgStepCount: Math.round(avgStepCount * 10) / 10,
      entryPointsFound,
    },
  };
};

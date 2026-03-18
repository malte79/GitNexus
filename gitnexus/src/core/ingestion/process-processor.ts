/**
 * Process Detection Processor
 *
 * Thin orchestration seam for process detection. Tracing, entry-point scoring,
 * and process assembly live in dedicated owners.
 */

import { GraphNode, KnowledgeGraph } from '../graph/types.js';
import type { CommunityMembership } from './community-types.js';
import { findEntryPoints } from './process-entry-point-support.js';
import { buildCallsGraph, buildReverseCallsGraph } from './process-graph-support.js';
import { createProcessDetectionResult } from './process-output-support.js';
import { collectProcessTraces } from './process-trace-support.js';
import {
  DEFAULT_PROCESS_DETECTION_CONFIG,
  type ProcessDetectionConfig,
  type ProcessDetectionResult,
  type ProcessNode,
  type ProcessStep,
} from './process-types.js';

export type { ProcessDetectionConfig, ProcessDetectionResult, ProcessNode, ProcessStep };

export const processProcesses = async (
  knowledgeGraph: KnowledgeGraph,
  memberships: CommunityMembership[],
  onProgress?: (message: string, progress: number) => void,
  config: Partial<ProcessDetectionConfig> = {}
): Promise<ProcessDetectionResult> => {
  const resolvedConfig = { ...DEFAULT_PROCESS_DETECTION_CONFIG, ...config };
  onProgress?.('Finding entry points...', 0);

  const callsEdges = buildCallsGraph(knowledgeGraph);
  const reverseCallsEdges = buildReverseCallsGraph(knowledgeGraph);
  const nodeMap = new Map<string, GraphNode>();
  for (const node of knowledgeGraph.iterNodes()) {
    nodeMap.set(node.id, node);
  }

  const entryPoints = findEntryPoints(knowledgeGraph, reverseCallsEdges, callsEdges);
  onProgress?.(`Found ${entryPoints.length} entry points, tracing flows...`, 20);

  const { allTraces, limitedTraces } = collectProcessTraces(entryPoints, callsEdges, resolvedConfig, onProgress);
  onProgress?.(`Found ${allTraces.length} traces, deduplicating...`, 60);
  onProgress?.(`Reduced to ${limitedTraces.length} process traces`, 70);
  onProgress?.(`Creating ${limitedTraces.length} process nodes...`, 80);

  const result = createProcessDetectionResult(limitedTraces, memberships, nodeMap, entryPoints.length);
  onProgress?.('Process detection complete!', 100);
  return result;
};

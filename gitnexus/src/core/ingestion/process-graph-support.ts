import { KnowledgeGraph } from '../graph/types.js';
import { AdjacencyList, MIN_TRACE_CONFIDENCE } from './process-types.js';

export const buildCallsGraph = (graph: KnowledgeGraph): AdjacencyList => {
  const adjacency = new Map<string, string[]>();

  for (const rel of graph.iterRelationships()) {
    if (rel.type === 'CALLS' && rel.confidence >= MIN_TRACE_CONFIDENCE) {
      if (!adjacency.has(rel.sourceId)) {
        adjacency.set(rel.sourceId, []);
      }
      adjacency.get(rel.sourceId)!.push(rel.targetId);
    }
  }

  return adjacency;
};

export const buildReverseCallsGraph = (graph: KnowledgeGraph): AdjacencyList => {
  const adjacency = new Map<string, string[]>();

  for (const rel of graph.iterRelationships()) {
    if (rel.type === 'CALLS' && rel.confidence >= MIN_TRACE_CONFIDENCE) {
      if (!adjacency.has(rel.targetId)) {
        adjacency.set(rel.targetId, []);
      }
      adjacency.get(rel.targetId)!.push(rel.sourceId);
    }
  }

  return adjacency;
};

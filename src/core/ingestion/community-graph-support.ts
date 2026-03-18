import Graph from 'graphology';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GraphNode, GraphRelationship, KnowledgeGraph, NodeLabel } from '../graph/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const leidenPath = resolve(__dirname, '..', '..', '..', 'vendor', 'leiden', 'index.cjs');
const _require = createRequire(import.meta.url);
const leiden = _require(leidenPath);

const MIN_CONFIDENCE_LARGE = 0.5;
const LEIDEN_TIMEOUT_MS = 60_000;

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRng = (seedSource: string): (() => number) => {
  let state = hashString(seedSource) || 0x811c9dc5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const countCommunitySymbols = (knowledgeGraph: KnowledgeGraph): number => {
  let symbolCount = 0;
  knowledgeGraph.forEachNode((node) => {
    if (node.label === 'Function' || node.label === 'Class' || node.label === 'Method' || node.label === 'Interface') {
      symbolCount++;
    }
  });
  return symbolCount;
};

export const buildCommunityGraphologyGraph = (knowledgeGraph: KnowledgeGraph, isLarge: boolean): any => {
  const graph = new (Graph as any)({ type: 'undirected', allowSelfLoops: false });
  const symbolTypes = new Set<NodeLabel>(['Function', 'Class', 'Method', 'Interface']);
  const clusteringRelTypes = new Set(['CALLS', 'EXTENDS', 'IMPLEMENTS']);
  const connectedNodes = new Set<string>();
  const nodeDegree = new Map<string, number>();
  const relevantRelationships: GraphRelationship[] = [];

  knowledgeGraph.forEachRelationship((relationship) => {
    if (!clusteringRelTypes.has(relationship.type) || relationship.sourceId === relationship.targetId) return;
    if (isLarge && relationship.confidence < MIN_CONFIDENCE_LARGE) return;

    relevantRelationships.push(relationship);
    connectedNodes.add(relationship.sourceId);
    connectedNodes.add(relationship.targetId);
    nodeDegree.set(relationship.sourceId, (nodeDegree.get(relationship.sourceId) || 0) + 1);
    nodeDegree.set(relationship.targetId, (nodeDegree.get(relationship.targetId) || 0) + 1);
  });

  const relevantNodes: GraphNode[] = [];
  knowledgeGraph.forEachNode((node) => {
    if (!symbolTypes.has(node.label) || !connectedNodes.has(node.id)) return;
    if (isLarge && (nodeDegree.get(node.id) || 0) < 2) return;
    relevantNodes.push(node);
  });

  for (const node of relevantNodes) {
    graph.addNode(node.id, {
      name: node.properties.name,
      filePath: node.properties.filePath,
      type: node.label,
    });
  }

  for (const relationship of relevantRelationships) {
    if (graph.hasNode(relationship.sourceId) && graph.hasNode(relationship.targetId) && !graph.hasEdge(relationship.sourceId, relationship.targetId)) {
      graph.addEdge(relationship.sourceId, relationship.targetId);
    }
  }

  return graph;
};

export const runLeidenDetection = async (
  graph: any,
  isLarge: boolean,
  onTimeout?: () => void
): Promise<{ communities: Record<string, number>; count: number; modularity: number }> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      Promise.resolve((leiden as any).detailed(graph, {
        resolution: isLarge ? 2.0 : 1.0,
        maxIterations: isLarge ? 3 : 0,
        rng: createSeededRng(`leiden:${graph.order}:${graph.size}`),
      })),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Leiden timeout')), LEIDEN_TIMEOUT_MS);
        timeoutHandle.unref?.();
      }),
    ]);
  } catch (error: any) {
    if (error.message !== 'Leiden timeout') {
      throw error;
    }

    onTimeout?.();
    const communities: Record<string, number> = {};
    graph.forEachNode((node: string) => {
      communities[node] = 0;
    });
    return { communities, count: 1, modularity: 0 };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

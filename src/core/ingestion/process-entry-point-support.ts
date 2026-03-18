import { KnowledgeGraph, NodeLabel } from '../graph/types.js';
import { calculateEntryPointScore, isTestFile } from './entry-point-scoring.js';
import { AdjacencyList, compareStrings } from './process-types.js';

const isDev = process.env.NODE_ENV === 'development';

export const findEntryPoints = (
  graph: KnowledgeGraph,
  reverseCallsEdges: AdjacencyList,
  callsEdges: AdjacencyList
): string[] => {
  const symbolTypes = new Set<NodeLabel>(['Function', 'Method']);
  const entryPointCandidates: {
    id: string;
    score: number;
    reasons: string[];
  }[] = [];

  for (const node of graph.iterNodes()) {
    if (!symbolTypes.has(node.label)) continue;

    const filePath = node.properties.filePath || '';
    if (isTestFile(filePath)) continue;

    const callers = reverseCallsEdges.get(node.id) || [];
    const callees = callsEdges.get(node.id) || [];
    if (callees.length === 0) continue;

    const { score: baseScore, reasons } = calculateEntryPointScore(
      node.properties.name,
      node.properties.language || 'javascript',
      node.properties.isExported ?? false,
      callers.length,
      callees.length,
      filePath
    );

    let score = baseScore;
    const astFrameworkMultiplier = node.properties.astFrameworkMultiplier ?? 1.0;
    if (astFrameworkMultiplier > 1.0) {
      score *= astFrameworkMultiplier;
      reasons.push(`framework-ast:${node.properties.astFrameworkReason || 'decorator'}`);
    }

    if (score > 0) {
      entryPointCandidates.push({ id: node.id, score, reasons });
    }
  }

  const sorted = entryPointCandidates.sort((a, b) =>
    b.score - a.score ||
    compareStrings(a.id, b.id)
  );

  if (sorted.length > 0 && isDev) {
    console.log('[Process] Top 10 entry point candidates (new scoring):');
    sorted.slice(0, 10).forEach((candidate, index) => {
      const node = graph.getNode(candidate.id);
      const exported = node?.properties.isExported ? '✓' : '✗';
      const shortPath = node?.properties.filePath?.split('/').slice(-2).join('/') || '';
      console.log(`  ${index + 1}. ${node?.properties.name} [exported:${exported}] (${shortPath})`);
      console.log(`     score: ${candidate.score.toFixed(2)} = [${candidate.reasons.join(' × ')}]`);
    });
  }

  return sorted
    .slice(0, 200)
    .map((candidate) => candidate.id);
};

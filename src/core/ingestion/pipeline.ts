import { createKnowledgeGraph } from '../graph/graph.js';
import { processStructure } from './structure-processor.js';
import { processCommunities } from './community-processor.js';
import { processProcesses } from './process-processor.js';
import { createSymbolTable } from './symbol-table.js';
import { createASTCache } from './ast-cache.js';
import { PipelineProgress, PipelineResult } from '../../types/pipeline.js';
import { createImportMap } from './import-processor.js';
import {
  cleanupPipelineState,
  runChunkedParsing,
  scanRepositoryForPipeline,
  type PipelineState,
} from './pipeline-support.js';

const AST_CACHE_CAP = 50;
const isDev = process.env.NODE_ENV === 'development';

export const runPipelineFromRepo = async (
  repoPath: string,
  onProgress: (progress: PipelineProgress) => void,
): Promise<PipelineResult> => {
  const state: PipelineState = {
    graph: createKnowledgeGraph(),
    symbolTable: createSymbolTable(),
    astCache: createASTCache(AST_CACHE_CAP),
    importMap: createImportMap(),
  };

  try {
    const scan = await scanRepositoryForPipeline(repoPath, state.graph, onProgress);

    onProgress({
      phase: 'structure',
      percent: 15,
      message: 'Analyzing project structure...',
      stats: { filesProcessed: 0, totalFiles: scan.totalFiles, nodesCreated: state.graph.nodeCount },
    });

    processStructure(state.graph, scan.allPaths);

    onProgress({
      phase: 'structure',
      percent: 20,
      message: 'Project structure analyzed',
      stats: { filesProcessed: scan.totalFiles, totalFiles: scan.totalFiles, nodesCreated: state.graph.nodeCount },
    });

    await runChunkedParsing(repoPath, scan, state, onProgress);

    onProgress({
      phase: 'communities',
      percent: 82,
      message: 'Detecting code communities...',
      stats: { filesProcessed: scan.totalFiles, totalFiles: scan.totalFiles, nodesCreated: state.graph.nodeCount },
    });

    const communityResult = await processCommunities(state.graph, (message, progress) => {
      onProgress({
        phase: 'communities',
        percent: Math.round(82 + (progress * 0.10)),
        message,
        stats: { filesProcessed: scan.totalFiles, totalFiles: scan.totalFiles, nodesCreated: state.graph.nodeCount },
      });
    });

    if (isDev) {
      console.log(`🏘️ Community detection: ${communityResult.stats.totalCommunities} communities found (modularity: ${communityResult.stats.modularity.toFixed(3)})`);
    }

    for (const community of communityResult.communities) {
      state.graph.addNode({
        id: community.id,
        label: 'Community' as const,
        properties: {
          name: community.label,
          filePath: '',
          heuristicLabel: community.heuristicLabel,
          cohesion: community.cohesion,
          symbolCount: community.symbolCount,
        },
      });
    }

    for (const membership of communityResult.memberships) {
      state.graph.addRelationship({
        id: `${membership.nodeId}_member_of_${membership.communityId}`,
        type: 'MEMBER_OF',
        sourceId: membership.nodeId,
        targetId: membership.communityId,
        confidence: 1.0,
        reason: 'leiden-algorithm',
      });
    }

    onProgress({
      phase: 'processes',
      percent: 94,
      message: 'Detecting execution flows...',
      stats: { filesProcessed: scan.totalFiles, totalFiles: scan.totalFiles, nodesCreated: state.graph.nodeCount },
    });

    let symbolCount = 0;
    state.graph.forEachNode((node) => {
      if (node.label !== 'File') symbolCount++;
    });
    const dynamicMaxProcesses = Math.max(20, Math.min(300, Math.round(symbolCount / 10)));

    const processResult = await processProcesses(
      state.graph,
      communityResult.memberships,
      (message, progress) => {
        onProgress({
          phase: 'processes',
          percent: Math.round(94 + (progress * 0.05)),
          message,
          stats: { filesProcessed: scan.totalFiles, totalFiles: scan.totalFiles, nodesCreated: state.graph.nodeCount },
        });
      },
      { maxProcesses: dynamicMaxProcesses, minSteps: 3 },
    );

    if (isDev) {
      console.log(`🔄 Process detection: ${processResult.stats.totalProcesses} processes found (${processResult.stats.crossCommunityCount} cross-community)`);
    }

    for (const process of processResult.processes) {
      state.graph.addNode({
        id: process.id,
        label: 'Process' as const,
        properties: {
          name: process.label,
          filePath: '',
          heuristicLabel: process.heuristicLabel,
          processType: process.processType,
          stepCount: process.stepCount,
          communities: process.communities,
          entryPointId: process.entryPointId,
          terminalId: process.terminalId,
        },
      });
    }

    for (const step of processResult.steps) {
      state.graph.addRelationship({
        id: `${step.nodeId}_step_${step.step}_${step.processId}`,
        type: 'STEP_IN_PROCESS',
        sourceId: step.nodeId,
        targetId: step.processId,
        confidence: 1.0,
        reason: 'trace-detection',
        step: step.step,
      });
    }

    onProgress({
      phase: 'complete',
      percent: 100,
      message: `Graph complete! ${communityResult.stats.totalCommunities} communities, ${processResult.stats.totalProcesses} processes detected.`,
      stats: {
        filesProcessed: scan.totalFiles,
        totalFiles: scan.totalFiles,
        nodesCreated: state.graph.nodeCount,
      },
    });

    state.astCache.clear();
    return {
      graph: state.graph,
      repoPath,
      totalFileCount: scan.totalFiles,
      communityResult,
      processResult,
    };
  } catch (error) {
    cleanupPipelineState(state);
    throw error;
  }
};

export interface ProcessDetectionConfig {
  maxTraceDepth: number;
  maxBranching: number;
  maxProcesses: number;
  minSteps: number;
}

export const DEFAULT_PROCESS_DETECTION_CONFIG: ProcessDetectionConfig = {
  maxTraceDepth: 10,
  maxBranching: 4,
  maxProcesses: 75,
  minSteps: 3,
};

export interface ProcessNode {
  id: string;
  label: string;
  heuristicLabel: string;
  processType: 'intra_community' | 'cross_community';
  stepCount: number;
  communities: string[];
  entryPointId: string;
  terminalId: string;
  trace: string[];
}

export interface ProcessStep {
  nodeId: string;
  processId: string;
  step: number;
}

export interface ProcessDetectionResult {
  processes: ProcessNode[];
  steps: ProcessStep[];
  stats: {
    totalProcesses: number;
    crossCommunityCount: number;
    avgStepCount: number;
    entryPointsFound: number;
  };
}

export type AdjacencyList = Map<string, string[]>;

export const MIN_TRACE_CONFIDENCE = 0.5;

export const compareStrings = (a: string, b: string): number => a.localeCompare(b);

export const traceKey = (trace: string[]): string => trace.join('->');

export const capitalize = (value: string): string => {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export const sanitizeId = (value: string): string => {
  return value.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20).toLowerCase();
};

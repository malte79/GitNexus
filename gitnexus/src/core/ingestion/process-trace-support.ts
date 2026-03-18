import { AdjacencyList, ProcessDetectionConfig, compareStrings, traceKey } from './process-types.js';

const traceFromEntryPoint = (
  entryId: string,
  callsEdges: AdjacencyList,
  config: ProcessDetectionConfig
): string[][] => {
  const traces: string[][] = [];
  const queue: [string, string[]][] = [[entryId, [entryId]]];

  while (queue.length > 0 && traces.length < config.maxBranching * 3) {
    const [currentId, path] = queue.shift()!;
    const callees = callsEdges.get(currentId) || [];

    if (callees.length === 0 || path.length >= config.maxTraceDepth) {
      if (path.length >= config.minSteps) {
        traces.push([...path]);
      }
      continue;
    }

    const limitedCallees = callees.slice(0, config.maxBranching);
    let addedBranch = false;

    for (const calleeId of limitedCallees) {
      if (!path.includes(calleeId)) {
        queue.push([calleeId, [...path, calleeId]]);
        addedBranch = true;
      }
    }

    if (!addedBranch && path.length >= config.minSteps) {
      traces.push([...path]);
    }
  }

  return traces;
};

const deduplicateTraces = (traces: string[][]): string[][] => {
  if (traces.length === 0) return [];

  const sorted = [...traces].sort((a, b) =>
    b.length - a.length ||
    compareStrings(traceKey(a), traceKey(b))
  );
  const unique: string[][] = [];

  for (const trace of sorted) {
    const currentTraceKey = traceKey(trace);
    const isSubset = unique.some((existing) => traceKey(existing).includes(currentTraceKey));
    if (!isSubset) {
      unique.push(trace);
    }
  }

  return unique;
};

const deduplicateByEndpoints = (traces: string[][]): string[][] => {
  if (traces.length === 0) return [];

  const byEndpoints = new Map<string, string[]>();
  const sorted = [...traces].sort((a, b) =>
    b.length - a.length ||
    compareStrings(traceKey(a), traceKey(b))
  );

  for (const trace of sorted) {
    const key = `${trace[0]}::${trace[trace.length - 1]}`;
    if (!byEndpoints.has(key)) {
      byEndpoints.set(key, trace);
    }
  }

  return Array.from(byEndpoints.entries())
    .sort(([keyA], [keyB]) => compareStrings(keyA, keyB))
    .map(([, trace]) => trace);
};

export const collectProcessTraces = (
  entryPoints: string[],
  callsEdges: AdjacencyList,
  config: ProcessDetectionConfig,
  onProgress?: (message: string, progress: number) => void
): { allTraces: string[][]; limitedTraces: string[][] } => {
  const allTraces: string[][] = [];

  for (let index = 0; index < entryPoints.length && allTraces.length < config.maxProcesses * 2; index++) {
    const entryId = entryPoints[index];
    const traces = traceFromEntryPoint(entryId, callsEdges, config);
    traces
      .filter((trace) => trace.length >= config.minSteps)
      .forEach((trace) => allTraces.push(trace));

    if (index % 10 === 0) {
      onProgress?.(
        `Tracing entry point ${index + 1}/${entryPoints.length}...`,
        20 + (index / entryPoints.length) * 40
      );
    }
  }

  const uniqueTraces = deduplicateTraces(allTraces);
  const endpointDeduped = deduplicateByEndpoints(uniqueTraces);
  const limitedTraces = endpointDeduped
    .sort((a, b) =>
      b.length - a.length ||
      compareStrings(traceKey(a), traceKey(b))
    )
    .slice(0, config.maxProcesses);

  return { allTraces, limitedTraces };
};

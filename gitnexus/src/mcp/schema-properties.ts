export const NODE_PROPERTY_GUIDE: Record<string, string[]> = {
  File: ['id', 'name', 'filePath', 'content', 'runtimeArea', 'description'],
  Folder: ['id', 'name', 'filePath'],
  Function: ['id', 'name', 'filePath', 'startLine', 'endLine', 'content', 'description', 'runtimeArea'],
  Class: ['id', 'name', 'filePath', 'startLine', 'endLine', 'content', 'description', 'runtimeArea'],
  Interface: ['id', 'name', 'filePath', 'startLine', 'endLine', 'content', 'description', 'runtimeArea'],
  Method: ['id', 'name', 'filePath', 'startLine', 'endLine', 'content', 'description', 'runtimeArea'],
  Module: ['id', 'name', 'filePath', 'startLine', 'endLine', 'description', 'runtimeArea'],
  Property: ['id', 'name', 'filePath', 'startLine', 'endLine', 'description', 'runtimeArea'],
  Constructor: ['id', 'name', 'filePath', 'startLine', 'endLine', 'content', 'description', 'runtimeArea'],
  CodeElement: ['id', 'name', 'filePath', 'startLine', 'endLine', 'content', 'description'],
  Community: ['id', 'label', 'heuristicLabel', 'cohesion', 'symbolCount', 'keywords', 'description'],
  Process: ['id', 'label', 'heuristicLabel', 'processType', 'stepCount', 'communities', 'entryPointId', 'terminalId'],
};

export function normalizeNodeType(input: string): string {
  const trimmed = input.replace(/`/g, '').trim();
  if (!trimmed) {
    return '';
  }

  const exact = Object.keys(NODE_PROPERTY_GUIDE).find((nodeType) => nodeType.toLowerCase() === trimmed.toLowerCase());
  if (exact) {
    return exact;
  }

  return trimmed;
}

export function getNodeProperties(nodeType: string): string[] | null {
  const normalized = normalizeNodeType(nodeType);
  return NODE_PROPERTY_GUIDE[normalized] ?? null;
}

export function listInspectableNodeTypes(): string[] {
  return Object.keys(NODE_PROPERTY_GUIDE).sort((a, b) => a.localeCompare(b));
}

export function getPropertyResourceUri(nodeType: string): string {
  return `gnexus://properties/${encodeURIComponent(normalizeNodeType(nodeType) || nodeType)}`;
}

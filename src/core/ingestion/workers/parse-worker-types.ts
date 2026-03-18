import type { RobloxPathSpec } from '../roblox/types.js';

export interface ParsedNode {
  id: string;
  label: string;
  properties: {
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    isExported: boolean;
    astFrameworkMultiplier?: number;
    astFrameworkReason?: string;
    description?: string;
    runtimeArea?: 'shared' | 'client' | 'server' | 'other';
  };
}

export interface ParsedRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'DEFINES';
  confidence: number;
  reason: string;
}

export interface ParsedSymbol {
  filePath: string;
  name: string;
  nodeId: string;
  type: string;
}

export interface ExtractedImport {
  filePath: string;
  language: string;
  rawImportPath?: string;
  robloxPath?: RobloxPathSpec;
}

export interface ExtractedCall {
  filePath: string;
  calledName: string;
  sourceId: string;
}

export interface ExtractedHeritage {
  filePath: string;
  className: string;
  parentName: string;
  kind: string;
}

export interface ExtractedRoute {
  filePath: string;
  httpMethod: string;
  routePath: string | null;
  controllerName: string | null;
  methodName: string | null;
  middleware: string[];
  prefix: string | null;
  lineNumber: number;
}

export interface ParseWorkerResult {
  nodes: ParsedNode[];
  relationships: ParsedRelationship[];
  symbols: ParsedSymbol[];
  imports: ExtractedImport[];
  calls: ExtractedCall[];
  heritage: ExtractedHeritage[];
  routes: ExtractedRoute[];
  fileCount: number;
}

export interface ParseWorkerInput {
  path: string;
  content: string;
}

/**
 * MCP Resources
 *
 * Provides repo-local structured data to AI agents.
 */

import type { LocalBackend } from './local/local-backend.js';
import {
  getNodeProperties,
  getPropertyResourceUri,
  listInspectableNodeTypes,
  normalizeNodeType,
} from './schema-properties.js';
import { checkStaleness } from './staleness.js';

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export function getResourceDefinitions(): ResourceDefinition[] {
  return [
    {
      uri: 'gitnexus://context',
      name: 'Repo Overview',
      description: 'Codebase stats, staleness check, and available tools for the bound repo.',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://clusters',
      name: 'Repo Modules',
      description: 'All functional areas for the bound repo.',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://processes',
      name: 'Repo Processes',
      description: 'All execution flows for the bound repo.',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://schema',
      name: 'Graph Schema',
      description: 'Node and edge schema for Cypher queries.',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://properties',
      name: 'Graph Properties',
      description: 'Inspectable node properties for common Cypher query targets.',
      mimeType: 'text/yaml',
    },
  ];
}

export function getResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: 'gitnexus://cluster/{clusterName}',
      name: 'Module Detail',
      description: 'Deep dive into a specific functional area in the bound repo.',
      mimeType: 'text/yaml',
    },
    {
      uriTemplate: 'gitnexus://process/{processName}',
      name: 'Process Trace',
      description: 'Step-by-step execution trace in the bound repo.',
      mimeType: 'text/yaml',
    },
    {
      uriTemplate: 'gitnexus://properties/{nodeType}',
      name: 'Node Properties',
      description: 'Inspectable properties for a specific node type.',
      mimeType: 'text/yaml',
    },
  ];
}

function parseUri(uri: string): { resourceType: string; param?: string } {
  if (uri === 'gitnexus://context') return { resourceType: 'context' };
  if (uri === 'gitnexus://clusters') return { resourceType: 'clusters' };
  if (uri === 'gitnexus://processes') return { resourceType: 'processes' };
  if (uri === 'gitnexus://schema') return { resourceType: 'schema' };
  if (uri === 'gitnexus://properties') return { resourceType: 'properties' };

  const clusterMatch = uri.match(/^gitnexus:\/\/cluster\/(.+)$/);
  if (clusterMatch) {
    return { resourceType: 'cluster', param: decodeURIComponent(clusterMatch[1]) };
  }

  const processMatch = uri.match(/^gitnexus:\/\/process\/(.+)$/);
  if (processMatch) {
    return { resourceType: 'process', param: decodeURIComponent(processMatch[1]) };
  }

  const propertiesMatch = uri.match(/^gitnexus:\/\/properties\/(.+)$/);
  if (propertiesMatch) {
    return { resourceType: 'properties-detail', param: decodeURIComponent(propertiesMatch[1]) };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

export async function readResource(uri: string, backend: LocalBackend): Promise<string> {
  const parsed = parseUri(uri);

  switch (parsed.resourceType) {
    case 'context':
      return getContextResource(backend);
    case 'clusters':
      return getClustersResource(backend);
    case 'processes':
      return getProcessesResource(backend);
    case 'schema':
      return getSchemaResource();
    case 'properties':
      return getPropertiesIndexResource();
    case 'cluster':
      return getClusterDetailResource(parsed.param!, backend);
    case 'process':
      return getProcessDetailResource(parsed.param!, backend);
    case 'properties-detail':
      return getPropertiesDetailResource(parsed.param!);
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

async function getContextResource(backend: LocalBackend): Promise<string> {
  const repo = await backend.resolveRepo();
  const context = backend.getContext();

  if (!context) {
    return 'error: No codebase loaded. Create .codenexus/config.toml and run codenexus manage index';
  }

  const staleness = checkStaleness(repo.repoPath, repo.lastCommit || 'HEAD');
  const lines: string[] = [
    `project: ${context.projectName}`,
  ];

  if (staleness.isStale && staleness.hint) {
    lines.push('');
    lines.push(`staleness: "${staleness.hint}"`);
  }

  lines.push('');
  lines.push('stats:');
  lines.push(`  files: ${context.stats.fileCount}`);
  lines.push(`  symbols: ${context.stats.functionCount}`);
  lines.push(`  processes: ${context.stats.processCount}`);
  lines.push('');
  lines.push('tools_available:');
  lines.push('  - summary: Compact repo and subsystem overview');
  lines.push('  - query: Process-grouped code intelligence');
  lines.push('  - context: 360-degree symbol view');
  lines.push('  - impact: Blast radius analysis');
  lines.push('  - detect_changes: Git-diff impact analysis');
  lines.push('  - rename: Multi-file coordinated rename');
  lines.push('  - cypher: Raw graph queries');
  lines.push('');
  lines.push('resources_available:');
  lines.push('  - gitnexus://context');
  lines.push('  - gitnexus://clusters');
  lines.push('  - gitnexus://processes');
  lines.push('  - gitnexus://schema');
  lines.push('  - gitnexus://properties');
  lines.push('  - gitnexus://cluster/{name}');
  lines.push('  - gitnexus://process/{name}');
  lines.push('  - gitnexus://properties/{nodeType}');

  return lines.join('\n');
}

async function getClustersResource(backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.queryClusters(100);

    if (!result.clusters || result.clusters.length === 0) {
      return 'modules: []\n# No functional areas detected. Run: codenexus manage index';
    }

    const displayLimit = 20;
    const lines: string[] = ['modules:'];
    const toShow = result.clusters.slice(0, displayLimit);

    for (const cluster of toShow) {
      const label = cluster.heuristicLabel || cluster.label || cluster.id;
      lines.push(`  - name: "${label}"`);
      lines.push(`    symbols: ${cluster.symbolCount || 0}`);
      if (cluster.cohesion) {
        lines.push(`    cohesion: ${(cluster.cohesion * 100).toFixed(0)}%`);
      }
    }

    if (result.clusters.length > displayLimit) {
      lines.push(`\n# Showing top ${displayLimit} of ${result.clusters.length} modules.`);
    }

    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

async function getProcessesResource(backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.queryProcesses(50);

    if (!result.processes || result.processes.length === 0) {
      return 'processes: []\n# No processes detected. Run: codenexus manage index';
    }

    const displayLimit = 20;
    const lines: string[] = ['processes:'];
    const toShow = result.processes.slice(0, displayLimit);

    for (const proc of toShow) {
      const label = proc.heuristicLabel || proc.label || proc.id;
      lines.push(`  - name: "${label}"`);
      lines.push(`    type: ${proc.processType || 'unknown'}`);
      lines.push(`    steps: ${proc.stepCount || 0}`);
    }

    if (result.processes.length > displayLimit) {
      lines.push(`\n# Showing top ${displayLimit} of ${result.processes.length} processes.`);
    }

    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

function getSchemaResource(): string {
  return `# CodeNexus Graph Schema

nodes:
  - File: Source code files
  - Folder: Directory containers
  - Function: Functions and arrow functions
  - Class: Class definitions
  - Interface: Interface/type definitions
  - Method: Class methods
  - CodeElement: Catch-all for other code elements
  - Community: Auto-detected functional area (Leiden algorithm)
  - Process: Execution flow trace

additional_node_types: "Multi-language: Struct, Enum, Macro, Typedef, Union, Namespace, Trait, Impl, TypeAlias, Const, Static, Property, Record, Delegate, Annotation, Constructor, Template, Module (use backticks in queries: \`Struct\`, \`Enum\`, etc.)"

relationships:
  - CONTAINS: File or folder contains child
  - DEFINES: File defines a symbol
  - CALLS: Function or method invocation
  - IMPORTS: Module imports
  - EXTENDS: Class inheritance
  - IMPLEMENTS: Interface implementation
  - MEMBER_OF: Symbol belongs to community
  - STEP_IN_PROCESS: Symbol is step N in process

relationship_table: "All relationships use a single CodeRelation table with a type property. Properties: type (STRING), confidence (DOUBLE), reason (STRING), step (INT32)"
`;
}

function getPropertiesIndexResource(): string {
  const lines = [
    '# CodeNexus Node Properties',
    '',
    'node_types:',
  ];

  for (const nodeType of listInspectableNodeTypes()) {
    lines.push(`  - ${nodeType}`);
    lines.push(`    uri: ${getPropertyResourceUri(nodeType)}`);
  }

  lines.push('');
  lines.push('usage: "READ gitnexus://properties/{nodeType} to inspect available properties before writing Cypher against that node label."');
  return lines.join('\n');
}

function getPropertiesDetailResource(nodeType: string): string {
  const normalized = normalizeNodeType(nodeType);
  const properties = getNodeProperties(normalized);
  if (!properties) {
    return `error: Unknown node type '${nodeType}'. Read gitnexus://properties for supported node labels.`;
  }

  return [
    `node_type: ${normalized}`,
    'properties:',
    ...properties.map((propertyName) => `  - ${propertyName}`),
    '',
    `schema_uri: gitnexus://schema`,
  ].join('\n');
}

async function getClusterDetailResource(name: string, backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.queryClusterDetail(name);

    if (result.error) {
      return `error: ${result.error}`;
    }

    const cluster = result.cluster;
    const members = result.members || [];
    const lines: string[] = [
      `module: "${cluster.heuristicLabel || cluster.label || cluster.id}"`,
      `symbols: ${cluster.symbolCount || members.length}`,
    ];

    if (cluster.cohesion) {
      lines.push(`cohesion: ${(cluster.cohesion * 100).toFixed(0)}%`);
    }

    if (members.length > 0) {
      lines.push('');
      lines.push('members:');
      for (const member of members.slice(0, 20)) {
        lines.push(`  - name: ${member.name}`);
        lines.push(`    type: ${member.type}`);
        lines.push(`    file: ${member.filePath}`);
      }
      if (members.length > 20) {
        lines.push(`  # ... and ${members.length - 20} more`);
      }
    }

    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

async function getProcessDetailResource(name: string, backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.queryProcessDetail(name);

    if (result.error) {
      return `error: ${result.error}`;
    }

    const proc = result.process;
    const steps = result.steps || [];
    const lines: string[] = [
      `name: "${proc.heuristicLabel || proc.label || proc.id}"`,
      `type: ${proc.processType || 'unknown'}`,
      `step_count: ${proc.stepCount || steps.length}`,
    ];

    if (steps.length > 0) {
      lines.push('');
      lines.push('trace:');
      for (const step of steps) {
        lines.push(`  ${step.step}: ${step.name} (${step.filePath})`);
      }
    }

    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

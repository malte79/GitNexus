import { executeQuery, isKuzuReady } from '../core/kuzu-adapter.js';
import { getNodeProperties, getPropertyResourceUri } from '../schema-properties.js';
import { CYPHER_WRITE_RE } from './local-backend-common.js';
import type { RepoHandle } from './local-backend-types.js';

export class LocalBackendCypherSupport {
  private extractCypherVariableLabel(query: string, variableName: string): string | null {
    const variablePattern = new RegExp(`\\(${variableName}:([\\w\`]+)`, 'i');
    const match = query.match(variablePattern);
    return match?.[1]?.replace(/`/g, '') ?? null;
  }

  private buildCypherError(query: string, errorMessage: string): any {
    const starterQueries = [
      "MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: 'start'}) RETURN a.name, a.filePath LIMIT 20",
      "MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community) RETURN c.heuristicLabel, COUNT(*) AS symbols ORDER BY symbols DESC LIMIT 20",
      "MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process) RETURN p.heuristicLabel, s.name, r.step ORDER BY p.heuristicLabel, r.step LIMIT 30",
    ];

    if (/\btype\s*\(/i.test(query) || /function TYPE does not exist/i.test(errorMessage)) {
      return {
        error: errorMessage,
        hint: "Use the CodeRelation `type` property instead of `type(r)`. Example: MATCH (a)-[r:CodeRelation {type: 'CALLS'}]->(b) RETURN a.name, b.name LIMIT 20",
        schema_resource: 'gnexus://schema',
        starter_queries: starterQueries,
      };
    }

    const propertyErrorMatch = errorMessage.match(/Cannot find property ([A-Za-z_][A-Za-z0-9_]*) for ([A-Za-z_][A-Za-z0-9_]*)/i);
    if (propertyErrorMatch) {
      const propertyName = propertyErrorMatch[1];
      const variableName = propertyErrorMatch[2];
      const nodeType = this.extractCypherVariableLabel(query, variableName);
      const availableProperties = nodeType ? getNodeProperties(nodeType) : null;
      const propertyResource = nodeType ? getPropertyResourceUri(nodeType) : 'gnexus://properties';
      const hint = availableProperties
        ? `Property \`${propertyName}\` is not available on ${nodeType}. Available properties include: ${availableProperties.join(', ')}.`
        : `Property \`${propertyName}\` is not available on \`${variableName}\`. Read gnexus://properties and gnexus://schema to inspect available node properties.`;

      return {
        error: errorMessage,
        hint,
        schema_resource: 'gnexus://schema',
        property_resource: propertyResource,
        ...(availableProperties ? { available_properties: availableProperties } : {}),
        starter_queries: starterQueries,
      };
    }

    return {
      error: errorMessage,
      hint: 'Use read-only Cypher over the single CodeRelation table and filter edge kinds with the `type` property.',
      schema_resource: 'gnexus://schema',
      property_resource: 'gnexus://properties',
      starter_queries: starterQueries,
    };
  }

  async execute(repo: RepoHandle, params: { query: string }): Promise<any> {
    if (!isKuzuReady(repo.id)) {
      return { error: 'KuzuDB not ready. Index may be corrupted.' };
    }

    if (CYPHER_WRITE_RE.test(params.query)) {
      return this.buildCypherError(
        params.query,
        'Write operations (CREATE, DELETE, SET, MERGE, REMOVE, DROP, ALTER, COPY, DETACH) are not allowed. The knowledge graph is read-only.',
      );
    }

    try {
      return await executeQuery(repo.id, params.query);
    } catch (err: any) {
      return this.buildCypherError(params.query, err.message || 'Query failed');
    }
  }

  formatAsMarkdown(result: any): any {
    if (!Array.isArray(result) || result.length === 0) return result;

    const firstRow = result[0];
    if (typeof firstRow !== 'object' || firstRow === null) return result;

    const keys = Object.keys(firstRow);
    if (keys.length === 0) return result;

    const header = '| ' + keys.join(' | ') + ' |';
    const separator = '| ' + keys.map(() => '---').join(' | ') + ' |';
    const dataRows = result.map((row: any) =>
      '| ' + keys.map((key) => {
        const value = row[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }).join(' | ') + ' |'
    );

    return {
      markdown: [header, separator, ...dataRows].join('\n'),
      row_count: result.length,
    };
  }
}

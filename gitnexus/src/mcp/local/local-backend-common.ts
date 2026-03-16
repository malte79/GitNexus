/** Quick test-file detection for filtering impact results. */
export function isTestFilePath(filePath: string): boolean {
  const p = filePath.toLowerCase().replace(/\\/g, '/');
  return (
    p.includes('.test.') || p.includes('.spec.') ||
    p.includes('__tests__/') || p.includes('__mocks__/') ||
    /(^|\/)(test|tests|testing|fixtures)(\/|$)/.test(p) ||
    p.endsWith('_test.go') || p.endsWith('_test.py') ||
    /(^|\/)test_/.test(p) || p.includes('/conftest.')
  );
}

/** Valid KuzuDB node labels for safe Cypher query construction. */
export const VALID_NODE_LABELS = new Set([
  'File', 'Folder', 'Function', 'Class', 'Interface', 'Method', 'CodeElement',
  'Community', 'Process', 'Struct', 'Enum', 'Macro', 'Typedef', 'Union',
  'Namespace', 'Trait', 'Impl', 'TypeAlias', 'Const', 'Static', 'Property',
  'Record', 'Delegate', 'Annotation', 'Constructor', 'Template', 'Module',
]);

/** Valid relation types for impact analysis filtering. */
export const VALID_RELATION_TYPES = new Set(['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']);

/** Regex to detect write operations in user-supplied Cypher queries. */
export const CYPHER_WRITE_RE = /\b(CREATE|DELETE|SET|MERGE|REMOVE|DROP|ALTER|COPY|DETACH)\b/i;

/** Check if a Cypher query contains write operations. */
export function isWriteQuery(query: string): boolean {
  return CYPHER_WRITE_RE.test(query);
}

/** Structured error logging for query failures. */
export function logQueryError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`CodeNexus [${context}]: ${msg}`);
}

import path from 'node:path';

export interface LuauModuleMethodRef {
  name: string;
  startLine: number;
  label: 'Method';
}

export interface LuauModuleSymbolCandidate {
  name: string;
  startLine: number;
  endLine: number;
  description: string;
  isExported: true;
  confidence: 'strong' | 'weak';
  methodRefs: LuauModuleMethodRef[];
}

interface NamedModuleSeed {
  declaration: any;
  methods: LuauModuleMethodRef[];
}

const getNamedChildren = (node: any): any[] => {
  const children: any[] = [];
  if (!node) return children;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) children.push(child);
  }
  return children;
};

const getVariableAssignment = (node: any): any | null => {
  if (!node || node.type !== 'variable_declaration') return null;
  return getNamedChildren(node).find(child => child.type === 'assignment_statement') ?? null;
};

const getVariableAssignmentParts = (node: any): { target: any | null; value: any | null } => {
  const variableList = getNamedChildren(node).find(child => child.type === 'variable_list');
  const expressionList = getNamedChildren(node).find(child => child.type === 'expression_list');
  return {
    target: variableList?.namedChild?.(0) ?? null,
    value: expressionList?.namedChild?.(0) ?? null,
  };
};

const getFileModuleBaseName = (filePath: string): string => {
  const fileName = path.basename(filePath);
  let stem = fileName.replace(/\.(lua|luau)$/i, '');
  if (stem === 'init') {
    return path.basename(path.dirname(filePath));
  }
  if (stem.endsWith('.client')) stem = stem.slice(0, -7);
  if (stem.endsWith('.server')) stem = stem.slice(0, -7);
  return stem;
};

const getQualifiedNameParts = (nameNode: any): { baseName: string; methodName: string } | null => {
  if (!nameNode) return null;
  if (nameNode.type !== 'dot_index_expression' && nameNode.type !== 'method_index_expression') {
    return null;
  }
  const base = nameNode.namedChild(0);
  const field = nameNode.namedChild(1);
  if (!base || !field || base.type !== 'identifier' || field.type !== 'identifier') {
    return null;
  }
  return { baseName: base.text, methodName: field.text };
};

const getReturnedIdentifier = (node: any): string | null => {
  if (!node || node.type !== 'return_statement') return null;
  const expressionList = getNamedChildren(node).find(child => child.type === 'expression_list');
  const returned = expressionList?.namedChild?.(0) ?? null;
  return returned?.type === 'identifier' ? returned.text : null;
};

const getReturnedTableLiteral = (node: any): any | null => {
  if (!node || node.type !== 'return_statement') return null;
  const expressionList = getNamedChildren(node).find(child => child.type === 'expression_list');
  const returned = expressionList?.namedChild?.(0) ?? null;
  return returned?.type === 'table_constructor' ? returned : null;
};

const getTableLiteralMethodRefs = (tableNode: any): LuauModuleMethodRef[] => {
  const refs: LuauModuleMethodRef[] = [];
  for (const child of getNamedChildren(tableNode)) {
    if (child.type !== 'field') continue;
    const fieldName = child.namedChild(0);
    const fieldValue = child.namedChild(1);
    if (!fieldName || fieldName.type !== 'identifier') continue;
    if (!fieldValue || fieldValue.type !== 'function_definition') continue;
    refs.push({
      name: fieldName.text,
      startLine: child.startPosition.row,
      label: 'Method',
    });
  }
  return refs;
};

export const extractLuauModuleSymbolCandidates = (
  rootNode: any,
  filePath: string,
): LuauModuleSymbolCandidate[] => {
  const namedModules = new Map<string, NamedModuleSeed>();
  const returnedNames = new Set<string>();
  const moduleMethods = new Map<string, LuauModuleMethodRef[]>();
  let returnedLiteralNode: any | null = null;

  for (const child of getNamedChildren(rootNode)) {
    if (child.type === 'variable_declaration') {
      const assignment = getVariableAssignment(child);
      if (assignment) {
        const { target, value } = getVariableAssignmentParts(assignment);
        if (target?.type === 'identifier' && value?.type === 'table_constructor') {
          namedModules.set(target.text, {
            declaration: child,
            methods: [],
          });
        }
      }
      continue;
    }

    if (child.type === 'function_declaration') {
      const qualified = getQualifiedNameParts(child.childForFieldName?.('name') ?? child.namedChild(0));
      if (qualified) {
        const refs = moduleMethods.get(qualified.baseName) ?? [];
        refs.push({
          name: qualified.methodName,
          startLine: child.startPosition.row,
          label: 'Method',
        });
        moduleMethods.set(qualified.baseName, refs);
      }
      continue;
    }

    if (child.type === 'assignment_statement') {
      const { target, value } = getVariableAssignmentParts(child);
      const qualified = getQualifiedNameParts(target);
      if (qualified && value?.type === 'function_definition') {
        const refs = moduleMethods.get(qualified.baseName) ?? [];
        refs.push({
          name: qualified.methodName,
          startLine: child.startPosition.row,
          label: 'Method',
        });
        moduleMethods.set(qualified.baseName, refs);
      }
      continue;
    }

    if (child.type === 'return_statement') {
      const returnedIdentifier = getReturnedIdentifier(child);
      if (returnedIdentifier) {
        returnedNames.add(returnedIdentifier);
        continue;
      }
      const returnedLiteral = getReturnedTableLiteral(child);
      if (returnedLiteral) {
        returnedLiteralNode = returnedLiteral;
      }
    }
  }

  const candidates: LuauModuleSymbolCandidate[] = [];
  for (const [name, seed] of namedModules.entries()) {
    if (!returnedNames.has(name)) continue;
    const refs = moduleMethods.get(name) ?? [];
    candidates.push({
      name,
      startLine: seed.declaration.startPosition.row,
      endLine: seed.declaration.endPosition.row,
      description: 'luau-module:strong:named-return-table',
      isExported: true,
      confidence: 'strong',
      methodRefs: refs,
    });
  }

  if (candidates.length === 0 && returnedLiteralNode) {
    const literalMethodRefs = getTableLiteralMethodRefs(returnedLiteralNode);
    if (literalMethodRefs.length > 0) {
      candidates.push({
        name: getFileModuleBaseName(filePath),
        startLine: returnedLiteralNode.startPosition.row,
        endLine: returnedLiteralNode.endPosition.row,
        description: 'luau-module:weak:return-table-literal',
        isExported: true,
        confidence: 'weak',
        methodRefs: literalMethodRefs,
      });
    }
  }

  return candidates;
};

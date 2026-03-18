import path from 'node:path';

export interface LuauModuleMemberRef {
  name: string;
  startLine: number;
  label: 'Method' | 'Function' | 'Property';
  targetName?: string;
  targetBaseName?: string;
  targetLabel?: 'Method' | 'Function';
  synthetic?: boolean;
}

export interface LuauModuleSymbolCandidate {
  name: string;
  startLine: number;
  endLine: number;
  description: string;
  isExported: true;
  confidence: 'strong' | 'weak';
  memberRefs: LuauModuleMemberRef[];
}

export interface LuauLocalTableContainerCandidate {
  name: string;
  startLine: number;
  endLine: number;
  description: string;
  memberRefs: LuauModuleMemberRef[];
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

interface LuauModuleAnalysis {
  namedModules: Map<string, any>;
  returnedNames: Set<string>;
  moduleMethods: Map<string, LuauModuleMemberRef[]>;
  returnedLiteralNode: any | null;
  weakWrapperBackingNames: Set<string>;
}

const getDelegateReturnTarget = (
  functionNode: any,
): { targetBaseName: string; targetName: string; targetLabel?: 'Method' | 'Function' } | null => {
  if (!functionNode || functionNode.type !== 'function_definition') return null;

  let returnNode: any | null = null;
  const stack = [...getNamedChildren(functionNode)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.type === 'return_statement') {
      if (returnNode) return null;
      returnNode = current;
      continue;
    }
    for (const child of getNamedChildren(current)) {
      stack.push(child);
    }
  }

  if (!returnNode) return null;
  const expressionList = getNamedChildren(returnNode).find(child => child.type === 'expression_list');
  const returned = expressionList?.namedChild?.(0) ?? null;
  if (!returned || returned.type !== 'function_call') return null;

  const callee = returned.childForFieldName?.('name') ?? returned.namedChild?.(0) ?? null;
  const qualified = getQualifiedNameParts(callee);
  if (!qualified) return null;

  return {
    targetBaseName: qualified.baseName,
    targetName: qualified.methodName,
    ...(callee.type === 'method_index_expression' ? { targetLabel: 'Method' as const } : {}),
  };
};

const getTableLiteralMemberRefs = (tableNode: any): LuauModuleMemberRef[] => {
  const refs: LuauModuleMemberRef[] = [];
  for (const child of getNamedChildren(tableNode)) {
    if (child.type !== 'field') continue;
    const fieldName = child.namedChild(0);
    const fieldValue = child.namedChild(1);
    if (!fieldName || fieldName.type !== 'identifier') continue;
    if (!fieldValue) continue;

    if (fieldValue.type === 'function_definition') {
      const delegateTarget = getDelegateReturnTarget(fieldValue);
      refs.push({
        name: fieldName.text,
        startLine: child.startPosition.row,
        label: 'Method',
        ...(delegateTarget ?? {}),
      });
      continue;
    }

    if (fieldValue.type === 'identifier') {
      refs.push({
        name: fieldName.text,
        startLine: child.startPosition.row,
        label: 'Property',
        targetName: fieldValue.text,
        synthetic: true,
      });
      continue;
    }

    const qualifiedValue = getQualifiedNameParts(fieldValue);
    if (qualifiedValue) {
      refs.push({
        name: fieldName.text,
        startLine: child.startPosition.row,
        label: 'Property',
        targetBaseName: qualifiedValue.baseName,
        targetName: qualifiedValue.methodName,
        ...(fieldValue.type === 'method_index_expression' ? { targetLabel: 'Method' as const } : {}),
        synthetic: true,
      });
    }
  }
  return refs;
};

const collectLuauModuleAnalysis = (rootNode: any): LuauModuleAnalysis => {
  const namedModules = new Map<string, any>();
  const returnedNames = new Set<string>();
  const moduleMethods = new Map<string, LuauModuleMemberRef[]>();
  let returnedLiteralNode: any | null = null;
  const weakWrapperBackingNames = new Set<string>();

  for (const child of getNamedChildren(rootNode)) {
    if (child.type === 'variable_declaration') {
      const assignment = getVariableAssignment(child);
      if (assignment) {
        const { target, value } = getVariableAssignmentParts(assignment);
        if (target?.type === 'identifier' && value?.type === 'table_constructor') {
          namedModules.set(target.text, child);
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
        for (const memberRef of getTableLiteralMemberRefs(returnedLiteral)) {
          if (typeof memberRef.targetBaseName === 'string' && memberRef.targetBaseName.length > 0) {
            weakWrapperBackingNames.add(memberRef.targetBaseName);
          }
        }
      }
    }
  }

  return {
    namedModules,
    returnedNames,
    moduleMethods,
    returnedLiteralNode,
    weakWrapperBackingNames,
  };
};

export const extractLuauModuleSymbolCandidates = (
  rootNode: any,
  filePath: string,
): LuauModuleSymbolCandidate[] => {
  const { namedModules, returnedNames, moduleMethods, returnedLiteralNode } = collectLuauModuleAnalysis(rootNode);

  const candidates: LuauModuleSymbolCandidate[] = [];
  for (const [name, declaration] of namedModules.entries()) {
    if (!returnedNames.has(name)) continue;
    const refs = moduleMethods.get(name) ?? [];
    candidates.push({
      name,
      startLine: declaration.startPosition.row,
      endLine: declaration.endPosition.row,
      description: 'luau-module:strong:named-return-table',
      isExported: true,
      confidence: 'strong',
      memberRefs: refs,
    });
  }

  if (candidates.length === 0 && returnedLiteralNode) {
    const literalMemberRefs = getTableLiteralMemberRefs(returnedLiteralNode);
    if (literalMemberRefs.length > 0) {
      const backingContainerNames = [...new Set(literalMemberRefs
        .map((memberRef) => memberRef.targetBaseName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .filter((name) => moduleMethods.has(name))
      )].sort();
      candidates.push({
        name: getFileModuleBaseName(filePath),
        startLine: returnedLiteralNode.startPosition.row,
        endLine: returnedLiteralNode.endPosition.row,
        description: backingContainerNames.length > 0
          ? `luau-module:weak:return-table-literal:backing=${backingContainerNames.join(',')}`
          : 'luau-module:weak:return-table-literal',
        isExported: true,
        confidence: 'weak',
        memberRefs: literalMemberRefs,
      });
    }
  }

  return candidates;
};

export const extractLuauLocalTableContainerCandidates = (
  rootNode: any,
): LuauLocalTableContainerCandidate[] => {
  const { namedModules, returnedNames, moduleMethods, weakWrapperBackingNames } = collectLuauModuleAnalysis(rootNode);

  const candidates: LuauLocalTableContainerCandidate[] = [];
  for (const [name, declaration] of namedModules.entries()) {
    if (returnedNames.has(name)) continue;
    if (!weakWrapperBackingNames.has(name)) continue;
    const memberRefs = moduleMethods.get(name) ?? [];
    if (memberRefs.length === 0) continue;
    candidates.push({
      name,
      startLine: declaration.startPosition.row,
      endLine: declaration.endPosition.row,
      description: 'luau-module:local-table',
      memberRefs,
    });
  }

  return candidates;
};

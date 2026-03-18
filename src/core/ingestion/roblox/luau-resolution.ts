import type { RobloxPathSpec } from './types.js';

const cloneSpec = (spec: RobloxPathSpec): RobloxPathSpec => ({
  ...spec,
  segments: [...spec.segments],
});

const getNamedChildren = (node: any): any[] => {
  const children: any[] = [];
  if (!node) return children;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) children.push(child);
  }
  return children;
};

const parseStringLiteral = (node: any): string | null => {
  if (!node) return null;
  if (node.type === 'string_content') return node.text;
  if (node.type === 'string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'string_content') return child.text;
    }
  }
  return null;
};

const appendSegment = (base: RobloxPathSpec, segment: string, sourceNode?: any): RobloxPathSpec => ({
  ...cloneSpec(base),
  segments: [...base.segments, segment],
  ...(sourceNode ? { sourceText: sourceNode.text } : {}),
});

const parseCallChain = (node: any, aliases: Map<string, RobloxPathSpec>): RobloxPathSpec | null => {
  if (!node || node.type !== 'function_call') return null;
  const callee = node.childForFieldName?.('name') ?? node.namedChild(0);
  const args = node.children?.find((child: any) => child.type === 'arguments');
  const argNode = args?.namedChild?.(0) ?? args?.namedChild(0);

  if (!callee) return null;

  if (callee.type === 'method_index_expression') {
    const receiver = callee.childForFieldName?.('object') ?? callee.namedChild(0);
    const method = callee.childForFieldName?.('method') ?? callee.namedChild(1);
    if (!method) return null;
    if (method.text === 'GetService' && receiver?.type === 'identifier' && receiver.text === 'game') {
      const serviceName = parseStringLiteral(argNode);
      if (!serviceName) return null;
      return {
        rootKind: 'service',
        serviceName,
        segments: [],
        sourceText: node.text,
      };
    }
    const receiverSpec = parseRobloxPathExpression(receiver, aliases);
    if (!receiverSpec) return null;
    if (method.text === 'WaitForChild') {
      const childName = parseStringLiteral(argNode);
      if (!childName) return null;
      return appendSegment(receiverSpec, childName, node);
    }
    return null;
  }

  if (callee.type === 'dot_index_expression') {
    const receiver = callee.childForFieldName?.('object') ?? callee.namedChild(0);
    const field = callee.childForFieldName?.('field') ?? callee.namedChild(1);
    const receiverSpec = parseRobloxPathExpression(receiver, aliases);
    if (!receiverSpec || !field) return null;
    return appendSegment(receiverSpec, field.text, node);
  }

  return null;
};

export const parseRobloxPathExpression = (
  node: any,
  aliases: Map<string, RobloxPathSpec>,
): RobloxPathSpec | null => {
  if (!node) return null;
  if (node.type === 'identifier') {
    return aliases.get(node.text) ? cloneSpec(aliases.get(node.text)!) : null;
  }
  if (node.type === 'function_call') {
    return parseCallChain(node, aliases);
  }
  if (node.type === 'dot_index_expression') {
    const receiver = node.childForFieldName?.('object') ?? node.namedChild(0);
    const field = node.childForFieldName?.('field') ?? node.namedChild(1);
    if (!receiver || !field) return null;
    if (receiver.type === 'identifier' && receiver.text === 'script' && field.text === 'Parent') {
      return {
        rootKind: 'script',
        parentDepth: 1,
        segments: [],
        sourceText: node.text,
      };
    }
    const receiverSpec = parseRobloxPathExpression(receiver, aliases);
    if (!receiverSpec) return null;
    if (field.text === 'Parent' && receiverSpec.rootKind === 'script') {
      return {
        ...cloneSpec(receiverSpec),
        parentDepth: (receiverSpec.parentDepth ?? 0) + 1,
        sourceText: node.text,
      };
    }
    return appendSegment(receiverSpec, field.text, node);
  }
  return null;
};

export const extractLuauRobloxAliasesAndImports = (
  rootNode: any,
  filePath: string,
): Array<{ filePath: string; language: string; robloxPath?: RobloxPathSpec; rawImportPath?: string }> => {
  const imports: Array<{ filePath: string; language: string; robloxPath?: RobloxPathSpec; rawImportPath?: string }> = [];
  const aliases = new Map<string, RobloxPathSpec>();

const processLocalAlias = (node: any) => {
  if (node.type !== 'variable_declaration') return;
    const assignment = getNamedChildren(node).find((child: any) => child.type === 'assignment_statement');
    const variableList = assignment?.children?.find((child: any) => child.type === 'variable_list');
    const expressionList = assignment?.children?.find((child: any) => child.type === 'expression_list');
    const target = variableList?.namedChild(0);
    const value = expressionList?.namedChild(0);
    if (!target || target.type !== 'identifier' || !value) return;
    const spec = parseRobloxPathExpression(value, aliases);
    if (spec) aliases.set(target.text, spec);
  };

  const walk = (node: any) => {
    if (node.type === 'variable_declaration') {
      processLocalAlias(node);
    }
    if (node.type === 'function_call') {
      const callee = node.childForFieldName?.('name') ?? node.namedChild(0);
      if (callee?.type === 'identifier' && callee.text === 'require') {
        const args = node.children?.find((child: any) => child.type === 'arguments');
        const argNode = args?.namedChild?.(0) ?? args?.namedChild(0);
        if (argNode) {
          const rawImportPath = parseStringLiteral(argNode);
          if (rawImportPath) {
            imports.push({ filePath, language: 'luau', rawImportPath });
          } else {
            const robloxPath = parseRobloxPathExpression(argNode, aliases);
            if (robloxPath) {
              imports.push({ filePath, language: 'luau', robloxPath });
            }
          }
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      walk(node.namedChild(i));
    }
  };

  walk(rootNode);
  return imports;
};

import Parser from 'tree-sitter';
import { SupportedLanguages } from '../../../config/supported-languages.js';
import { findSiblingChild } from '../utils.js';
import { detectFrameworkFromAST } from '../framework-detection.js';
import { generateId } from '../../../lib/utils.js';
import { extractLuauLocalTableContainerCandidates, extractLuauModuleSymbolCandidates } from '../luau-module-symbols.js';
import { extractLuauRobloxAliasesAndImports } from '../roblox/luau-resolution.js';
import { BUILT_IN_NAMES } from '../call-noise.js';
import type {
  ExtractedRoute,
  ParsedNode,
  ParseWorkerInput,
  ParseWorkerResult,
} from './parse-worker-types.js';

const DEFINITION_CAPTURE_KEYS = [
  'definition.function',
  'definition.class',
  'definition.interface',
  'definition.method',
  'definition.struct',
  'definition.enum',
  'definition.namespace',
  'definition.module',
  'definition.trait',
  'definition.impl',
  'definition.type',
  'definition.const',
  'definition.static',
  'definition.typedef',
  'definition.macro',
  'definition.union',
  'definition.property',
  'definition.record',
  'definition.delegate',
  'definition.annotation',
  'definition.constructor',
  'definition.template',
] as const;

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration', 'arrow_function', 'function_expression',
  'method_definition', 'generator_function_declaration',
  'function_definition', 'async_function_declaration', 'async_arrow_function',
  'method_declaration', 'constructor_declaration',
  'local_function_statement', 'function_item', 'impl_item',
  'lambda_literal', 'anonymous_function',
  'init_declaration', 'deinit_declaration',
]);

const ELOQUENT_ARRAY_PROPS = new Set(['fillable', 'casts', 'hidden', 'guarded', 'with', 'appends']);
const ELOQUENT_RELATIONS = new Set([
  'hasMany', 'hasOne', 'belongsTo', 'belongsToMany',
  'morphTo', 'morphMany', 'morphOne', 'morphToMany', 'morphedByMany',
  'hasManyThrough', 'hasOneThrough',
]);
const ROUTE_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'any', 'match']);
const ROUTE_RESOURCE_METHODS = new Set(['resource', 'apiResource']);
const RESOURCE_ACTIONS = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];
const API_RESOURCE_ACTIONS = ['index', 'store', 'show', 'update', 'destroy'];

export const appendKotlinWildcard = (importPath: string, importNode: any): string => {
  for (let i = 0; i < importNode.childCount; i++) {
    if (importNode.child(i)?.type === 'wildcard_import') {
      return importPath.endsWith('.*') ? importPath : `${importPath}.*`;
    }
  }
  return importPath;
};

export const getDefinitionNodeFromCaptures = (captureMap: Record<string, any>): any | null => {
  for (const key of DEFINITION_CAPTURE_KEYS) {
    if (captureMap[key]) return captureMap[key];
  }
  return null;
};

const getLabelFromCaptures = (captureMap: Record<string, any>): string | null => {
  if (captureMap['import'] || captureMap['call']) return null;
  if (!captureMap['name']) return null;
  if (captureMap['definition.function']) return 'Function';
  if (captureMap['definition.class']) return 'Class';
  if (captureMap['definition.interface']) return 'Interface';
  if (captureMap['definition.method']) return 'Method';
  if (captureMap['definition.struct']) return 'Struct';
  if (captureMap['definition.enum']) return 'Enum';
  if (captureMap['definition.namespace']) return 'Namespace';
  if (captureMap['definition.module']) return 'Module';
  if (captureMap['definition.trait']) return 'Trait';
  if (captureMap['definition.impl']) return 'Impl';
  if (captureMap['definition.type']) return 'TypeAlias';
  if (captureMap['definition.const']) return 'Const';
  if (captureMap['definition.static']) return 'Static';
  if (captureMap['definition.typedef']) return 'Typedef';
  if (captureMap['definition.macro']) return 'Macro';
  if (captureMap['definition.union']) return 'Union';
  if (captureMap['definition.property']) return 'Property';
  if (captureMap['definition.record']) return 'Record';
  if (captureMap['definition.delegate']) return 'Delegate';
  if (captureMap['definition.annotation']) return 'Annotation';
  if (captureMap['definition.constructor']) return 'Constructor';
  if (captureMap['definition.template']) return 'Template';
  return 'CodeElement';
};

export const isNodeExported = (node: any, name: string, language: string): boolean => {
  let current = node;

  switch (language) {
    case 'javascript':
    case 'typescript':
      while (current) {
        const type = current.type;
        if (type === 'export_statement' ||
            type === 'export_specifier' ||
            type === 'lexical_declaration' && current.parent?.type === 'export_statement') {
          return true;
        }
        if (current.text?.startsWith('export ')) return true;
        current = current.parent;
      }
      return false;
    case 'python':
      return !name.startsWith('_');
    case 'luau':
      while (current) {
        if (current.type === 'local_declaration') return false;
        if (current.type === 'assignment_statement') {
          const variableList = current.children?.find((c: any) => c.type === 'variable_list');
          const assignedName = variableList?.childForFieldName?.('name') || variableList?.namedChild?.(0);
          if (assignedName?.type === 'dot_index_expression' || assignedName?.type === 'method_index_expression') {
            return true;
          }
        }
        if (current.type === 'function_declaration') {
          const nameNode = current.childForFieldName?.('name');
          return nameNode?.type === 'identifier';
        }
        current = current.parent;
      }
      return false;
    case 'java':
      while (current) {
        if (current.parent) {
          const parent = current.parent;
          for (let i = 0; i < parent.childCount; i++) {
            const child = parent.child(i);
            if (child?.type === 'modifiers' && child.text?.includes('public')) return true;
          }
          if ((parent.type === 'method_declaration' || parent.type === 'constructor_declaration') &&
              parent.text?.trimStart().startsWith('public')) {
            return true;
          }
        }
        current = current.parent;
      }
      return false;
    case 'csharp':
      while (current) {
        if ((current.type === 'modifier' || current.type === 'modifiers') && current.text?.includes('public')) {
          return true;
        }
        current = current.parent;
      }
      return false;
    case 'go':
      if (name.length === 0) return false;
      return name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
    case 'rust':
      while (current) {
        if (current.type === 'visibility_modifier' && current.text?.includes('pub')) return true;
        current = current.parent;
      }
      return false;
    case 'kotlin':
      while (current) {
        if (current.parent) {
          const visMod = findSiblingChild(current.parent, 'modifiers', 'visibility_modifier');
          if (visMod) {
            const text = visMod.text;
            if (text === 'private' || text === 'internal' || text === 'protected') return false;
            if (text === 'public') return true;
          }
        }
        current = current.parent;
      }
      return true;
    case 'c':
    case 'cpp':
      return false;
    case 'php':
      while (current) {
        if (current.type === 'class_declaration' ||
            current.type === 'interface_declaration' ||
            current.type === 'trait_declaration' ||
            current.type === 'enum_declaration') {
          return true;
        }
        if (current.type === 'visibility_modifier') {
          return current.text === 'public';
        }
        current = current.parent;
      }
      return true;
    case 'swift':
      while (current) {
        if ((current.type === 'modifiers' || current.type === 'visibility_modifier')) {
          const text = current.text || '';
          if (text.includes('public') || text.includes('open')) return true;
        }
        current = current.parent;
      }
      return false;
    default:
      return false;
  }
};

const findEnclosingFunctionId = (node: any, filePath: string): string | null => {
  let current = node.parent;
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      let funcName: string | null = null;
      let label = 'Function';

      if (current.type === 'init_declaration' || current.type === 'deinit_declaration') {
        const initName = current.type === 'init_declaration' ? 'init' : 'deinit';
        return generateId('Constructor', `${filePath}:${initName}:${current.startPosition?.row ?? 0}`);
      }

      if (['function_declaration', 'async_function_declaration', 'generator_function_declaration', 'function_item'].includes(current.type)) {
        const nameNode = current.childForFieldName?.('name') ||
          current.children?.find((c: any) => c.type === 'identifier' || c.type === 'property_identifier');
        if (nameNode?.type === 'method_index_expression') {
          funcName = nameNode.childForFieldName?.('method')?.text ||
            nameNode.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        } else if (nameNode?.type === 'dot_index_expression') {
          funcName = nameNode.childForFieldName?.('field')?.text ||
            nameNode.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        } else {
          funcName = nameNode?.text;
        }
      } else if (current.type === 'impl_item') {
        const funcItem = current.children?.find((c: any) => c.type === 'function_item');
        if (funcItem) {
          const nameNode = funcItem.childForFieldName?.('name') ||
            funcItem.children?.find((c: any) => c.type === 'identifier');
          funcName = nameNode?.text;
          label = 'Method';
        }
      } else if (current.type === 'method_definition') {
        const nameNode = current.childForFieldName?.('name') ||
          current.children?.find((c: any) => c.type === 'property_identifier');
        funcName = nameNode?.text;
        label = 'Method';
      } else if (current.type === 'method_declaration' || current.type === 'constructor_declaration') {
        const nameNode = current.childForFieldName?.('name') ||
          current.children?.find((c: any) => c.type === 'identifier');
        funcName = nameNode?.text;
        label = 'Method';
      } else if (current.type === 'arrow_function' || current.type === 'function_expression') {
        const parent = current.parent;
        if (parent?.type === 'variable_declarator') {
          const nameNode = parent.childForFieldName?.('name') ||
            parent.children?.find((c: any) => c.type === 'identifier');
          funcName = nameNode?.text;
        }
      } else if (current.type === 'function_definition') {
        const expressionList = current.parent;
        const assignment = expressionList?.type === 'expression_list' ? expressionList.parent : null;
        const variableList = assignment?.children?.find((c: any) => c.type === 'variable_list');
        const assignedName = variableList?.childForFieldName?.('name') || variableList?.namedChild?.(0);
        if (assignedName?.type === 'identifier') {
          funcName = assignedName.text;
        } else if (assignedName?.type === 'dot_index_expression') {
          funcName = assignedName.childForFieldName?.('field')?.text ||
            assignedName.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        } else if (assignedName?.type === 'method_index_expression') {
          funcName = assignedName.childForFieldName?.('method')?.text ||
            assignedName.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        }
      }

      if (funcName) {
        const startLine = current.startPosition?.row ?? 0;
        return generateId(label, `${filePath}:${funcName}:${startLine}`);
      }
    }
    current = current.parent;
  }
  return null;
};

const resolveLuauModuleMethodId = (
  result: ParseWorkerResult,
  filePath: string,
  methodRef: { name: string; startLine: number; label: string; targetName?: string; targetLabel?: string },
): string | null => {
  if (methodRef.targetLabel) {
    const directId = generateId(methodRef.targetLabel, `${filePath}:${methodRef.targetName || methodRef.name}:${methodRef.startLine}`);
    if (result.symbols.some((symbol) => symbol.filePath === filePath && symbol.nodeId === directId)) {
      return directId;
    }
  }

  const targetName = methodRef.targetName || methodRef.name;
  const exact = result.symbols.find((symbol) =>
    symbol.filePath === filePath &&
    symbol.name === targetName &&
    (
      methodRef.targetLabel
        ? symbol.type === methodRef.targetLabel
        : symbol.type === 'Method' ||
          symbol.type === 'Function' ||
          symbol.type === 'Property' ||
          symbol.type === 'Const' ||
          symbol.type === 'Static' ||
          symbol.type === 'CodeElement'
    ),
  );
  return exact?.nodeId ?? null;
};

const createSyntheticLuauModuleMemberNode = (
  moduleId: string,
  filePath: string,
  memberRef: { name: string; startLine: number; label: string },
): ParsedNode => ({
  id: generateId('Property', `${moduleId}:${memberRef.name}:${memberRef.startLine}`),
  label: 'Property',
  properties: {
    name: memberRef.name,
    filePath,
    startLine: memberRef.startLine,
    endLine: memberRef.startLine,
    language: SupportedLanguages.Luau,
    isExported: true,
    description: 'luau-module-export:returned-table-field',
  },
});

const appendLuauContainerSymbols = (
  result: ParseWorkerResult,
  filePath: string,
  containers: Array<{
    name: string;
    startLine: number;
    endLine: number;
    description: string;
    confidence?: 'strong' | 'weak';
    memberRefs: Array<{ name: string; startLine: number; label: string; targetName?: string; targetLabel?: string; synthetic?: boolean }>;
  }>,
  isExported: boolean,
  defaultConfidence: number,
) => {
  const existingIds = new Set(result.symbols
    .filter(sym => sym.filePath === filePath)
    .map(sym => sym.nodeId));

  for (const container of containers) {
    const moduleId = generateId('Module', `${filePath}:${container.name}:${container.startLine}`);
    if (existingIds.has(moduleId)) continue;

    result.nodes.push({
      id: moduleId,
      label: 'Module',
      properties: {
        name: container.name,
        filePath,
        startLine: container.startLine,
        endLine: container.endLine,
        language: SupportedLanguages.Luau,
        isExported,
        description: container.description,
      },
    });

    result.symbols.push({
      filePath,
      name: container.name,
      nodeId: moduleId,
      type: 'Module',
    });

    const fileId = generateId('File', filePath);
    result.relationships.push({
      id: generateId('DEFINES', `${fileId}->${moduleId}`),
      sourceId: fileId,
      targetId: moduleId,
      type: 'DEFINES',
      confidence: container.confidence === 'strong' ? 1.0 : container.confidence === 'weak' ? 0.7 : defaultConfidence,
      reason: container.description,
    });

    existingIds.add(moduleId);

    for (const memberRef of container.memberRefs) {
      let memberId = resolveLuauModuleMethodId(result, filePath, memberRef);
      if (!memberId && memberRef.synthetic) {
        const syntheticNode = createSyntheticLuauModuleMemberNode(moduleId, filePath, memberRef);
        if (!existingIds.has(syntheticNode.id)) {
          result.nodes.push(syntheticNode);
          result.symbols.push({
            filePath,
            name: memberRef.name,
            nodeId: syntheticNode.id,
            type: 'Property',
          });
          existingIds.add(syntheticNode.id);
        }
        memberId = syntheticNode.id;
      }
      if (!memberId || !existingIds.has(memberId)) continue;

      result.relationships.push({
        id: generateId('DEFINES', `${moduleId}->${memberId}`),
        sourceId: moduleId,
        targetId: memberId,
        type: 'DEFINES',
        confidence: container.confidence === 'strong' ? 1.0 : container.confidence === 'weak' ? 0.7 : defaultConfidence,
        reason: container.description,
      });
    }
  }
};

const appendLuauModuleSymbols = (
  result: ParseWorkerResult,
  rootNode: any,
  filePath: string,
): void => {
  const candidates = extractLuauModuleSymbolCandidates(rootNode, filePath);
  const localContainers = extractLuauLocalTableContainerCandidates(rootNode);
  if (candidates.length === 0 && localContainers.length === 0) return;

  appendLuauContainerSymbols(result, filePath, candidates, true, 0.7);
  appendLuauContainerSymbols(result, filePath, localContainers, false, 0.85);
};

function findDescendant(node: any, type: string): any {
  if (node.type === type) return node;
  for (const child of (node.children ?? [])) {
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

function extractStringContent(node: any): string | null {
  if (!node) return null;
  const content = node.children?.find((c: any) => c.type === 'string_content');
  if (content) return content.text;
  if (node.type === 'string_content') return node.text;
  return null;
}

function extractPhpPropertyDescription(propName: string, propDeclNode: any): string | null {
  if (!ELOQUENT_ARRAY_PROPS.has(propName)) return null;
  const arrayNode = findDescendant(propDeclNode, 'array_creation_expression');
  if (!arrayNode) return null;

  const items: string[] = [];
  for (const child of (arrayNode.children ?? [])) {
    if (child.type !== 'array_element_initializer') continue;
    const children = child.children ?? [];
    const arrowIdx = children.findIndex((c: any) => c.type === '=>');
    if (arrowIdx !== -1) {
      const key = extractStringContent(children[arrowIdx - 1]);
      const val = extractStringContent(children[arrowIdx + 1]);
      if (key && val) items.push(`${key}:${val}`);
    } else {
      const val = extractStringContent(children[0]);
      if (val) items.push(val);
    }
  }

  return items.length > 0 ? items.join(', ') : null;
}

function extractEloquentRelationDescription(methodNode: any): string | null {
  function findRelationCall(node: any): any {
    if (node.type === 'member_call_expression') {
      const children = node.children ?? [];
      const objectNode = children.find((c: any) => c.type === 'variable_name' && c.text === '$this');
      const nameNode = children.find((c: any) => c.type === 'name');
      if (objectNode && nameNode && ELOQUENT_RELATIONS.has(nameNode.text)) return node;
    }
    for (const child of (node.children ?? [])) {
      const found = findRelationCall(child);
      if (found) return found;
    }
    return null;
  }

  const callNode = findRelationCall(methodNode);
  if (!callNode) return null;

  const relType = callNode.children?.find((c: any) => c.type === 'name')?.text;
  const argsNode = callNode.children?.find((c: any) => c.type === 'arguments');
  let targetModel: string | null = null;
  if (argsNode) {
    const firstArg = argsNode.children?.find((c: any) => c.type === 'argument');
    if (firstArg) {
      const classConstant = firstArg.children?.find((c: any) => c.type === 'class_constant_access_expression');
      if (classConstant) {
        targetModel = classConstant.children?.find((c: any) => c.type === 'name')?.text ?? null;
      }
    }
  }

  if (relType && targetModel) return `${relType}(${targetModel})`;
  return relType ?? null;
}

function isRouteStaticCall(node: any): boolean {
  if (node.type !== 'scoped_call_expression') return false;
  const obj = node.childForFieldName?.('object') ?? node.children?.[0];
  return obj?.text === 'Route';
}

function getCallMethodName(node: any): string | null {
  const nameNode = node.childForFieldName?.('name') ??
    node.children?.find((c: any) => c.type === 'name');
  return nameNode?.text ?? null;
}

function getArguments(node: any): any {
  return node.children?.find((c: any) => c.type === 'arguments') ?? null;
}

function findClosureBody(argsNode: any): any | null {
  if (!argsNode) return null;
  for (const child of argsNode.children ?? []) {
    if (child.type === 'argument') {
      for (const inner of child.children ?? []) {
        if (inner.type === 'anonymous_function' || inner.type === 'arrow_function') {
          return inner.childForFieldName?.('body') ??
            inner.children?.find((c: any) => c.type === 'compound_statement');
        }
      }
    }
    if (child.type === 'anonymous_function' || child.type === 'arrow_function') {
      return child.childForFieldName?.('body') ??
        child.children?.find((c: any) => c.type === 'compound_statement');
    }
  }
  return null;
}

function extractFirstStringArg(argsNode: any): string | null {
  if (!argsNode) return null;
  for (const child of argsNode.children ?? []) {
    const target = child.type === 'argument' ? child.children?.[0] : child;
    if (!target) continue;
    if (target.type === 'string' || target.type === 'encapsed_string') {
      return extractStringContent(target);
    }
  }
  return null;
}

function extractMiddlewareArg(argsNode: any): string[] {
  if (!argsNode) return [];
  for (const child of argsNode.children ?? []) {
    const target = child.type === 'argument' ? child.children?.[0] : child;
    if (!target) continue;
    if (target.type === 'string' || target.type === 'encapsed_string') {
      const val = extractStringContent(target);
      return val ? [val] : [];
    }
    if (target.type === 'array_creation_expression') {
      const items: string[] = [];
      for (const el of target.children ?? []) {
        if (el.type === 'array_element_initializer') {
          const str = el.children?.find((c: any) => c.type === 'string' || c.type === 'encapsed_string');
          const val = str ? extractStringContent(str) : null;
          if (val) items.push(val);
        }
      }
      return items;
    }
  }
  return [];
}

function extractClassArg(argsNode: any): string | null {
  if (!argsNode) return null;
  for (const child of argsNode.children ?? []) {
    const target = child.type === 'argument' ? child.children?.[0] : child;
    if (target?.type === 'class_constant_access_expression') {
      return target.children?.find((c: any) => c.type === 'name')?.text ?? null;
    }
  }
  return null;
}

function extractControllerTarget(argsNode: any): { controller: string | null; method: string | null } {
  if (!argsNode) return { controller: null, method: null };

  const args: any[] = [];
  for (const child of argsNode.children ?? []) {
    if (child.type === 'argument') args.push(child.children?.[0]);
    else if (child.type !== '(' && child.type !== ')' && child.type !== ',') args.push(child);
  }

  const handlerNode = args[1];
  if (!handlerNode) return { controller: null, method: null };

  if (handlerNode.type === 'array_creation_expression') {
    let controller: string | null = null;
    let method: string | null = null;
    const elements: any[] = [];
    for (const el of handlerNode.children ?? []) {
      if (el.type === 'array_element_initializer') elements.push(el);
    }
    if (elements[0]) {
      const classAccess = findDescendant(elements[0], 'class_constant_access_expression');
      if (classAccess) {
        controller = classAccess.children?.find((c: any) => c.type === 'name')?.text ?? null;
      }
    }
    if (elements[1]) {
      const str = findDescendant(elements[1], 'string');
      method = str ? extractStringContent(str) : null;
    }
    return { controller, method };
  }

  if (handlerNode.type === 'string' || handlerNode.type === 'encapsed_string') {
    const text = extractStringContent(handlerNode);
    if (text?.includes('@')) {
      const [controller, method] = text.split('@');
      return { controller, method };
    }
  }

  if (handlerNode.type === 'class_constant_access_expression') {
    const controller = handlerNode.children?.find((c: any) => c.type === 'name')?.text ?? null;
    return { controller, method: '__invoke' };
  }

  return { controller: null, method: null };
}

interface RouteGroupContext {
  middleware: string[];
  prefix: string | null;
  controller: string | null;
}

interface ChainedRouteCall {
  isRouteFacade: boolean;
  terminalMethod: string;
  attributes: { method: string; argsNode: any }[];
  terminalArgs: any;
  node: any;
}

function unwrapRouteChain(node: any): ChainedRouteCall | null {
  if (node.type !== 'member_call_expression') return null;

  const terminalMethod = getCallMethodName(node);
  if (!terminalMethod) return null;

  const terminalArgs = getArguments(node);
  const attributes: { method: string; argsNode: any }[] = [];
  let current = node.children?.[0];

  while (current) {
    if (current.type === 'member_call_expression') {
      const method = getCallMethodName(current);
      const args = getArguments(current);
      if (method) attributes.unshift({ method, argsNode: args });
      current = current.children?.[0];
    } else if (current.type === 'scoped_call_expression') {
      const obj = current.childForFieldName?.('object') ?? current.children?.[0];
      if (obj?.text !== 'Route') return null;
      const method = getCallMethodName(current);
      const args = getArguments(current);
      if (method) attributes.unshift({ method, argsNode: args });
      return { isRouteFacade: true, terminalMethod, attributes, terminalArgs, node };
    } else {
      break;
    }
  }
  return null;
}

function parseArrayGroupArgs(argsNode: any): RouteGroupContext {
  const ctx: RouteGroupContext = { middleware: [], prefix: null, controller: null };
  if (!argsNode) return ctx;

  for (const child of argsNode.children ?? []) {
    const target = child.type === 'argument' ? child.children?.[0] : child;
    if (target?.type !== 'array_creation_expression') continue;
    for (const el of target.children ?? []) {
      if (el.type !== 'array_element_initializer') continue;
      const children = el.children ?? [];
      const arrowIdx = children.findIndex((c: any) => c.type === '=>');
      if (arrowIdx === -1) continue;
      const key = extractStringContent(children[arrowIdx - 1]);
      const val = children[arrowIdx + 1];
      if (key === 'middleware') {
        if (val?.type === 'string') {
          const s = extractStringContent(val);
          if (s) ctx.middleware.push(s);
        } else if (val?.type === 'array_creation_expression') {
          for (const item of val.children ?? []) {
            if (item.type === 'array_element_initializer') {
              const str = item.children?.find((c: any) => c.type === 'string');
              const s = str ? extractStringContent(str) : null;
              if (s) ctx.middleware.push(s);
            }
          }
        }
      } else if (key === 'prefix') {
        ctx.prefix = extractStringContent(val) ?? null;
      } else if (key === 'controller' && val?.type === 'class_constant_access_expression') {
        ctx.controller = val.children?.find((c: any) => c.type === 'name')?.text ?? null;
      }
    }
  }

  return ctx;
}

export function extractLaravelRoutes(tree: any, filePath: string): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  function resolveStack(stack: RouteGroupContext[]) {
    const middleware: string[] = [];
    let prefix: string | null = null;
    let controller: string | null = null;
    for (const ctx of stack) {
      middleware.push(...ctx.middleware);
      if (ctx.prefix) prefix = prefix ? `${prefix}/${ctx.prefix}`.replace(/\/+/g, '/') : ctx.prefix;
      if (ctx.controller) controller = ctx.controller;
    }
    return { middleware, prefix, controller };
  }

  function emitRoute(
    httpMethod: string,
    argsNode: any,
    lineNumber: number,
    groupStack: RouteGroupContext[],
    chainAttrs: { method: string; argsNode: any }[],
  ) {
    const effective = resolveStack(groupStack);
    for (const attr of chainAttrs) {
      if (attr.method === 'middleware') effective.middleware.push(...extractMiddlewareArg(attr.argsNode));
      if (attr.method === 'prefix') {
        const p = extractFirstStringArg(attr.argsNode);
        if (p) effective.prefix = effective.prefix ? `${effective.prefix}/${p}` : p;
      }
      if (attr.method === 'controller') {
        const cls = extractClassArg(attr.argsNode);
        if (cls) effective.controller = cls;
      }
    }

    const routePath = extractFirstStringArg(argsNode);
    if (ROUTE_RESOURCE_METHODS.has(httpMethod)) {
      const target = extractControllerTarget(argsNode);
      const actions = httpMethod === 'apiResource' ? API_RESOURCE_ACTIONS : RESOURCE_ACTIONS;
      for (const action of actions) {
        routes.push({
          filePath, httpMethod, routePath,
          controllerName: target.controller ?? effective.controller,
          methodName: action,
          middleware: [...effective.middleware],
          prefix: effective.prefix,
          lineNumber,
        });
      }
    } else {
      const target = extractControllerTarget(argsNode);
      routes.push({
        filePath, httpMethod, routePath,
        controllerName: target.controller ?? effective.controller,
        methodName: target.method,
        middleware: [...effective.middleware],
        prefix: effective.prefix,
        lineNumber,
      });
    }
  }

  function walk(node: any, groupStack: RouteGroupContext[]) {
    if (isRouteStaticCall(node)) {
      const method = getCallMethodName(node);
      if (method && (ROUTE_HTTP_METHODS.has(method) || ROUTE_RESOURCE_METHODS.has(method))) {
        emitRoute(method, getArguments(node), node.startPosition.row, groupStack, []);
        return;
      }
      if (method === 'group') {
        const argsNode = getArguments(node);
        const groupCtx = parseArrayGroupArgs(argsNode);
        const body = findClosureBody(argsNode);
        if (body) {
          groupStack.push(groupCtx);
          walkChildren(body, groupStack);
          groupStack.pop();
        }
        return;
      }
    }

    const chain = unwrapRouteChain(node);
    if (chain) {
      if (chain.terminalMethod === 'group') {
        const groupCtx: RouteGroupContext = { middleware: [], prefix: null, controller: null };
        for (const attr of chain.attributes) {
          if (attr.method === 'middleware') groupCtx.middleware.push(...extractMiddlewareArg(attr.argsNode));
          if (attr.method === 'prefix') groupCtx.prefix = extractFirstStringArg(attr.argsNode);
          if (attr.method === 'controller') groupCtx.controller = extractClassArg(attr.argsNode);
        }
        const body = findClosureBody(chain.terminalArgs);
        if (body) {
          groupStack.push(groupCtx);
          walkChildren(body, groupStack);
          groupStack.pop();
        }
        return;
      }
      if (ROUTE_HTTP_METHODS.has(chain.terminalMethod) || ROUTE_RESOURCE_METHODS.has(chain.terminalMethod)) {
        emitRoute(chain.terminalMethod, chain.terminalArgs, node.startPosition.row, groupStack, chain.attributes);
        return;
      }
    }

    walkChildren(node, groupStack);
  }

  function walkChildren(node: any, groupStack: RouteGroupContext[]) {
    for (const child of node.children ?? []) {
      walk(child, groupStack);
    }
  }

  walk(tree.rootNode, []);
  return routes;
}

export const processFileGroup = (
  files: ParseWorkerInput[],
  language: SupportedLanguages,
  queryString: string,
  parser: Parser,
  result: ParseWorkerResult,
  onFileProcessed?: () => void,
): void => {
  let query: any;
  try {
    query = new Parser.Query(parser.getLanguage(), queryString);
  } catch {
    return;
  }

  for (const file of files) {
    if (file.content.length > 512 * 1024) continue;

    let tree;
    try {
      tree = parser.parse(file.content, undefined, { bufferSize: 1024 * 256 });
    } catch {
      continue;
    }

    result.fileCount++;
    onFileProcessed?.();

    let matches;
    try {
      matches = query.matches(tree.rootNode);
    } catch {
      continue;
    }

    for (const match of matches) {
      const captureMap: Record<string, any> = {};
      for (const c of match.captures) {
        captureMap[c.name] = c.node;
      }

      if (captureMap['import'] && captureMap['import.source']) {
        if (language !== SupportedLanguages.Luau) {
          const rawImportPath = language === SupportedLanguages.Kotlin
            ? appendKotlinWildcard(captureMap['import.source'].text.replace(/['"<>]/g, ''), captureMap['import'])
            : captureMap['import.source'].text.replace(/['"<>]/g, '');
          result.imports.push({
            filePath: file.path,
            rawImportPath,
            language,
          });
        }
        continue;
      }

      if (captureMap['call']) {
        const callNameNode = captureMap['call.name'];
        if (callNameNode) {
          const calledName = callNameNode.text;
          if (!BUILT_IN_NAMES.has(calledName)) {
            const callNode = captureMap['call'];
            const sourceId = findEnclosingFunctionId(callNode, file.path) || generateId('File', file.path);
            result.calls.push({ filePath: file.path, calledName, sourceId });
          }
        }
        continue;
      }

      if (captureMap['heritage.class']) {
        if (captureMap['heritage.extends']) {
          result.heritage.push({
            filePath: file.path,
            className: captureMap['heritage.class'].text,
            parentName: captureMap['heritage.extends'].text,
            kind: 'extends',
          });
        }
        if (captureMap['heritage.implements']) {
          result.heritage.push({
            filePath: file.path,
            className: captureMap['heritage.class'].text,
            parentName: captureMap['heritage.implements'].text,
            kind: 'implements',
          });
        }
        if (captureMap['heritage.trait']) {
          result.heritage.push({
            filePath: file.path,
            className: captureMap['heritage.class'].text,
            parentName: captureMap['heritage.trait'].text,
            kind: 'trait-impl',
          });
        }
        if (captureMap['heritage.extends'] || captureMap['heritage.implements'] || captureMap['heritage.trait']) {
          continue;
        }
      }

      const nodeLabel = getLabelFromCaptures(captureMap);
      if (!nodeLabel) continue;

      const nameNode = captureMap['name'];
      if (!nameNode && nodeLabel !== 'Constructor') continue;
      const nodeName = nameNode ? nameNode.text : 'init';
      const definitionNode = getDefinitionNodeFromCaptures(captureMap);
      const startLine = definitionNode ? definitionNode.startPosition.row : (nameNode ? nameNode.startPosition.row : 0);
      const nodeId = generateId(nodeLabel, `${file.path}:${nodeName}:${startLine}`);

      let description: string | undefined;
      if (language === SupportedLanguages.PHP) {
        if (nodeLabel === 'Property' && captureMap['definition.property']) {
          description = extractPhpPropertyDescription(nodeName, captureMap['definition.property']) ?? undefined;
        } else if (nodeLabel === 'Method' && captureMap['definition.method']) {
          description = extractEloquentRelationDescription(captureMap['definition.method']) ?? undefined;
        }
      }

      const frameworkHint = definitionNode
        ? detectFrameworkFromAST(language, (definitionNode.text || '').slice(0, 300))
        : null;

      result.nodes.push({
        id: nodeId,
        label: nodeLabel,
        properties: {
          name: nodeName,
          filePath: file.path,
          startLine: definitionNode ? definitionNode.startPosition.row : startLine,
          endLine: definitionNode ? definitionNode.endPosition.row : startLine,
          language,
          isExported: isNodeExported(nameNode || definitionNode, nodeName, language),
          ...(frameworkHint ? {
            astFrameworkMultiplier: frameworkHint.entryPointMultiplier,
            astFrameworkReason: frameworkHint.reason,
          } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });

      result.symbols.push({
        filePath: file.path,
        name: nodeName,
        nodeId,
        type: nodeLabel,
      });

      const fileId = generateId('File', file.path);
      result.relationships.push({
        id: generateId('DEFINES', `${fileId}->${nodeId}`),
        sourceId: fileId,
        targetId: nodeId,
        type: 'DEFINES',
        confidence: 1.0,
        reason: '',
      });
    }

    if (language === SupportedLanguages.PHP && ((file.path.includes('/routes/') || file.path.startsWith('routes/')) && file.path.endsWith('.php'))) {
      result.routes.push(...extractLaravelRoutes(tree, file.path));
    }

    if (language === SupportedLanguages.Luau) {
      appendLuauModuleSymbols(result, tree.rootNode, file.path);
      result.imports.push(...extractLuauRobloxAliasesAndImports(tree.rootNode, file.path));
    }
  }
};

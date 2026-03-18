import { SupportedLanguages } from '../../config/supported-languages.js';
import { generateId } from '../../lib/utils.js';
import { detectFrameworkFromAST } from './framework-detection.js';
import { extractLuauLocalTableContainerCandidates, extractLuauModuleSymbolCandidates } from './luau-module-symbols.js';
import { findSiblingChild } from './utils.js';
import type { ParsedNode, ParsedRelationship, ParsedSymbol } from './workers/parse-worker-types.js';

type CaptureMap = Record<string, any>;

type LuauMemberRef = {
  name: string;
  startLine: number;
  label: string;
  targetName?: string;
  targetLabel?: string;
  synthetic?: boolean;
};

type LuauContainerCandidate = {
  name: string;
  startLine: number;
  endLine: number;
  description: string;
  confidence?: 'strong' | 'weak';
  memberRefs: LuauMemberRef[];
};

type DescribeDefinition = (
  captureMap: CaptureMap,
  nodeLabel: string,
  nodeName: string,
) => string | undefined;

type LuauModuleSymbolSink = {
  hasNode(id: string): boolean;
  addNode(node: ParsedNode): void;
  addSymbol(symbol: ParsedSymbol): void;
  addRelationship(relationship: ParsedRelationship): void;
  resolveMemberId(filePath: string, memberRef: LuauMemberRef): string | null;
};

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

export const getDefinitionNodeFromCaptures = (captureMap: CaptureMap): any | null => {
  for (const key of DEFINITION_CAPTURE_KEYS) {
    if (captureMap[key]) return captureMap[key];
  }
  return null;
};

export const getLabelFromCaptures = (captureMap: CaptureMap): string | null => {
  if (captureMap.import || captureMap.call) return null;
  if (!captureMap.name && !captureMap['definition.constructor']) return null;
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
        if (
          type === 'export_statement' ||
          type === 'export_specifier' ||
          (type === 'lexical_declaration' && current.parent?.type === 'export_statement')
        ) {
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
          if (
            (parent.type === 'method_declaration' || parent.type === 'constructor_declaration') &&
            parent.text?.trimStart().startsWith('public')
          ) {
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
        if (
          current.type === 'class_declaration' ||
          current.type === 'interface_declaration' ||
          current.type === 'trait_declaration' ||
          current.type === 'enum_declaration'
        ) {
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
        if (current.type === 'modifiers' || current.type === 'visibility_modifier') {
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

export const createDefinitionArtifacts = (
  captureMap: CaptureMap,
  filePath: string,
  language: string,
  describeDefinition?: DescribeDefinition,
): { node: ParsedNode; symbol: ParsedSymbol; relationship: ParsedRelationship } | null => {
  const nodeLabel = getLabelFromCaptures(captureMap);
  if (!nodeLabel) return null;

  const nameNode = captureMap.name;
  if (!nameNode && nodeLabel !== 'Constructor') return null;
  const nodeName = nameNode ? nameNode.text : 'init';
  const definitionNode = getDefinitionNodeFromCaptures(captureMap);
  const startLine = definitionNode ? definitionNode.startPosition.row : (nameNode ? nameNode.startPosition.row : 0);
  const nodeId = generateId(nodeLabel, `${filePath}:${nodeName}:${startLine}`);
  const frameworkHint = definitionNode
    ? detectFrameworkFromAST(language, (definitionNode.text || '').slice(0, 300))
    : null;
  const description = describeDefinition?.(captureMap, nodeLabel, nodeName);

  return {
    node: {
      id: nodeId,
      label: nodeLabel,
      properties: {
        name: nodeName,
        filePath,
        startLine: definitionNode ? definitionNode.startPosition.row : startLine,
        endLine: definitionNode ? definitionNode.endPosition.row : startLine,
        language,
        isExported: isNodeExported(nameNode || definitionNode, nodeName, language),
        ...(frameworkHint
          ? {
              astFrameworkMultiplier: frameworkHint.entryPointMultiplier,
              astFrameworkReason: frameworkHint.reason,
            }
          : {}),
        ...(description !== undefined ? { description } : {}),
      },
    },
    symbol: {
      filePath,
      name: nodeName,
      nodeId,
      type: nodeLabel,
    },
    relationship: {
      id: generateId('DEFINES', `${generateId('File', filePath)}->${nodeId}`),
      sourceId: generateId('File', filePath),
      targetId: nodeId,
      type: 'DEFINES',
      confidence: 1.0,
      reason: '',
    },
  };
};

const createSyntheticLuauModuleMemberNode = (
  moduleId: string,
  filePath: string,
  memberRef: LuauMemberRef,
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
  sink: LuauModuleSymbolSink,
  filePath: string,
  containers: LuauContainerCandidate[],
  isExported: boolean,
  defaultConfidence: number,
) => {
  for (const container of containers) {
    const moduleId = generateId('Module', `${filePath}:${container.name}:${container.startLine}`);
    if (sink.hasNode(moduleId)) continue;

    sink.addNode({
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

    sink.addSymbol({
      filePath,
      name: container.name,
      nodeId: moduleId,
      type: 'Module',
    });

    sink.addRelationship({
      id: generateId('DEFINES', `${generateId('File', filePath)}->${moduleId}`),
      sourceId: generateId('File', filePath),
      targetId: moduleId,
      type: 'DEFINES',
      confidence:
        container.confidence === 'strong' ? 1.0 : container.confidence === 'weak' ? 0.7 : defaultConfidence,
      reason: container.description,
    });

    for (const memberRef of container.memberRefs) {
      let memberId = sink.resolveMemberId(filePath, memberRef);
      if (!memberId && memberRef.synthetic) {
        const syntheticNode = createSyntheticLuauModuleMemberNode(moduleId, filePath, memberRef);
        if (!sink.hasNode(syntheticNode.id)) {
          sink.addNode(syntheticNode);
          sink.addSymbol({
            filePath,
            name: memberRef.name,
            nodeId: syntheticNode.id,
            type: 'Property',
          });
        }
        memberId = syntheticNode.id;
      }
      if (!memberId || !sink.hasNode(memberId)) continue;

      sink.addRelationship({
        id: generateId('DEFINES', `${moduleId}->${memberId}`),
        sourceId: moduleId,
        targetId: memberId,
        type: 'DEFINES',
        confidence:
          container.confidence === 'strong' ? 1.0 : container.confidence === 'weak' ? 0.7 : defaultConfidence,
        reason: container.description,
      });
    }
  }
};

export const appendLuauModuleSymbols = (
  rootNode: any,
  filePath: string,
  sink: LuauModuleSymbolSink,
): void => {
  const candidates = extractLuauModuleSymbolCandidates(rootNode, filePath);
  const localContainers = extractLuauLocalTableContainerCandidates(rootNode);
  if (candidates.length === 0 && localContainers.length === 0) return;

  appendLuauContainerSymbols(sink, filePath, candidates, true, 0.7);
  appendLuauContainerSymbols(sink, filePath, localContainers, false, 0.85);
};
